import type { Agent } from "../../../src/config/types.ts";

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function items(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function content(value: unknown): string {
  if (typeof value === "string") return value;
  return items(value)
    .map((v) => String(v.text ?? ""))
    .join("\n");
}
function cursorPayload(value: unknown) {
  const result = object(object(value).result);
  const success = object(result.success);
  const failure = object(result.failure ?? result.error ?? result.rejected);
  return Object.keys(success).length ? success : failure;
}
function cursorText(payload: Record<string, unknown>) {
  return ["stdout", "stderr", "output", "content", "interleavedOutput"]
    .map((key) => payload[key])
    .filter((item): item is string => typeof item === "string")
    .join("\n");
}

export interface CallerEvent {
  kind: "call" | "result";
  id: string;
  tool: string;
  operation: string;
  run?: string | undefined;
  status?: string | undefined;
  exit?: number | undefined;
  handle?: string | undefined;
  yielded?: boolean | undefined;
  timeout?: number | undefined;
  skillLoaded?: boolean | undefined;
}

export class CallerEvidence {
  readonly events: CallerEvent[] = [];
  readonly context = {
    noHistory: false,
    modelReceived: false,
    canaryReceived: false,
    completed: false,
  };
  readonly agent: Agent;
  readonly model: string;
  readonly canary: string | undefined;
  receipt: Record<string, unknown> | undefined;
  constructor(agent: Agent, model: string, canary?: string) {
    this.agent = agent;
    this.model = model;
    this.canary = canary;
  }
  private assistant(text: string) {
    if (this.events.length) return;
    const answer = text.includes("STARTUP")
      ? text.match(/\{[^}]+\}/)?.[0]
      : undefined;
    if (!answer) return;
    let value: Record<string, unknown>;
    try {
      value = object(JSON.parse(answer));
    } catch {
      return;
    }
    this.receipt = {
      history: ["none", "known", "unavailable"].includes(String(value.history))
        ? value.history
        : "other",
      run:
        value.run === null
          ? null
          : typeof value.run === "string" &&
              /^r-\d{8}-\d{4}-[a-f0-9]{4}$/.test(value.run)
            ? value.run
            : "other",
      status:
        value.status === null
          ? null
          : ["running", "completed", "partial", "failed"].includes(
                String(value.status),
              )
            ? value.status
            : "other",
    };
    this.context.noHistory =
      value.history === "none" && value.run === null && value.status === null;
    this.context.modelReceived =
      value.model === this.model ||
      value.model === `${this.agent}/${this.model}`;
    this.context.canaryReceived =
      !!this.canary && value.history === "known" && value.run === this.canary;
    this.context.completed =
      value.history === "known" && value.status === "completed";
  }
  private call(id: unknown, tool: unknown, input: unknown) {
    const args = object(input);
    const text =
      typeof input === "string"
        ? input
        : Object.values(args)
            .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
            .join("\n");
    const tracked = this.events.find(
      (e) =>
        e.kind === "result" &&
        e.yielded &&
        e.handle &&
        text.includes(`${e.handle}.output`),
    );
    const operation =
      /\breview\b/.test(text) && /--scope/.test(text)
        ? "review"
        : /\bwait\s+r-\d{8}-\d{4}-[a-f0-9]{4}/.test(text)
          ? "wait"
          : (tool === "Skill" && args.skill === "degreaser") ||
              (/[/\\]degreaser[/\\]SKILL\.md\b/.test(text) &&
                /read|cat/i.test(`${tool} ${text}`))
            ? "skill"
            : /continuation\.txt/.test(text)
              ? "continue"
              : tracked || /write_stdin/.test(`${tool} ${text}`)
                ? "poll"
                : /--help/.test(text)
                  ? "help"
                  : "other";
    this.events.push({
      kind: "call",
      id: String(id),
      tool: String(tool),
      operation,
      run: text.match(/r-\d{8}-\d{4}-[a-f0-9]{4}/)?.[0],
      handle: tracked
        ? tracked.handle
        : args.session_id === undefined
          ? text.match(/["']?session_id["']?\s*:\s*(\d+)/)?.[1]
          : String(args.session_id),
      timeout: typeof args.timeout === "number" ? args.timeout : undefined,
    });
  }
  private result(id: unknown, output: string, exit?: number) {
    const call = this.events.find(
      (e) => e.kind === "call" && e.id === String(id),
    );
    if (!call) return;
    let envelope: Record<string, unknown> = {};
    if (this.agent === "codex") {
      try {
        envelope = object(
          JSON.parse(
            output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1),
          ),
        );
      } catch {}
      if (typeof envelope.output === "string") output = envelope.output;
      if (typeof envelope.exit_code === "number") exit = envelope.exit_code;
    }
    const exitMatch = output.match(
      /(?:exited with (?:code|exit code)|exit_code[":\s]+)\s*(\d+)/,
    )?.[1];
    const controlOutput =
      call.operation !== "skill" && call.operation !== "help";
    const handle =
      typeof envelope.session_id === "number"
        ? String(envelope.session_id)
        : output.match(
            /(?:Process running with session ID|background with ID:|<task-id>)\s*([a-zA-Z0-9_-]+)/,
          )?.[1];
    this.events.push({
      kind: "result",
      id: call.id,
      tool: call.tool,
      operation: call.operation,
      run: output.match(
        /(?:run:\s*|run_id[":\s]+)(r-\d{8}-\d{4}-[a-f0-9]{4})/,
      )?.[1],
      status: controlOutput
        ? output.match(
            /\bstatus:\s*(running|completed|partial|failed|no-changes)\b/,
          )?.[1]
        : undefined,
      exit: exit ?? (exitMatch === undefined ? undefined : Number(exitMatch)),
      yielded: controlOutput && !!handle,
      handle: controlOutput ? handle : undefined,
      skillLoaded:
        call.operation === "skill" &&
        (/(?:^|\n)(?:\s*\d+[→\t ]+)?name:\s*degreaser\s*(?:\n|$)/.test(
          output,
        ) ||
          (call.tool === "Skill" &&
            output.includes("Launching skill: degreaser"))),
    });
  }
  record(value: unknown) {
    const event = object(value);
    if (this.agent === "pi") {
      if (event.type === "tool_execution_start")
        this.call(event.toolCallId, event.toolName, event.args);
      if (event.type === "tool_execution_end")
        this.result(event.toolCallId, content(object(event.result).content));
      const message = object(event.message);
      if (event.type === "message_end" && message.role === "assistant")
        this.assistant(content(message.content));
    } else if (this.agent === "claude") {
      for (const block of items(object(event.message).content)) {
        if (event.type === "assistant" && block.type === "tool_use")
          this.call(block.id, block.name, block.input);
        if (event.type === "user" && block.type === "tool_result")
          this.result(block.tool_use_id, content(block.content));
        if (event.type === "assistant" && block.type === "text")
          this.assistant(String(block.text));
      }
    } else if (this.agent === "cursor") {
      if (event.type === "result" && typeof event.result === "string")
        this.assistant(event.result);
      for (const block of items(object(event.message).content))
        if (block.type === "text") this.assistant(String(block.text));
      const entry = Object.entries(object(event.tool_call)).find(([, body]) =>
        object(object(body).args),
      );
      if (event.type !== "tool_call" || !entry) return;
      const [name, body] = entry;
      const args = object(object(body).args);
      const known = this.events.some(
        (e) => e.kind === "call" && e.id === String(event.call_id),
      );
      if (
        event.subtype === "started" ||
        (event.subtype === "completed" && !known)
      )
        this.call(event.call_id, name, args);
      if (event.subtype === "completed") {
        const payload = cursorPayload(body);
        const exit = payload.exitCode ?? payload.exit_code;
        this.result(
          event.call_id,
          cursorText(payload),
          typeof exit === "number" ? exit : undefined,
        );
      }
    } else if (event.method === "rawResponseItem/completed") {
      const item = object(object(event.params).item);
      if (item.type === "function_call") {
        let args: unknown = {};
        try {
          args = JSON.parse(String(item.arguments));
        } catch {}
        this.call(item.call_id, item.name, args);
      }
      if (item.type === "custom_tool_call")
        this.call(item.call_id, item.name, item.input);
      if (
        item.type === "function_call_output" ||
        item.type === "custom_tool_call_output"
      )
        this.result(item.call_id, content(item.output));
      if (item.type === "message" && item.role === "assistant")
        this.assistant(content(item.content));
    }
  }
}
