import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isElementAccessExpression,
  isIdentifier,
  isNewExpression,
  isPropertyAccessExpression,
  isStringLiteralLikeNode,
} from "typescript/unstable/ast";
import { ASPECT_IDS, ASPECTS } from "../src/modules/aspect/api.ts";
import { AGENTS, HARNESSES } from "../src/modules/harness/api.ts";
import {
  cycles,
  imports,
  localTarget,
  parseSources,
  sourceFiles,
  visit,
} from "./utils/source-graph.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const paths = sourceFiles(join(root, "src"));
const parsed = parseSources(root, paths);
const production = paths.filter((path) => !path.endsWith(".test.ts"));
const name = (path: string) => relative(join(root, "src"), path);

test("source imports obey layers, including dynamic and type-only edges, without cycles", () => {
  const problems: string[] = [],
    graph = new Map<string, string[]>();
  const allows: Record<string, string[]> = {
    cli: ["review", "report", "install", "state", "config", "modules"],
    review: ["modules", "state", "config"],
    report: ["state", "review", "modules"],
    install: ["modules", "state", "config"],
    state: ["review", "config"],
    modules: ["config"],
    config: ["modules"],
    util: [],
  };
  for (const path of production) {
    const from = name(path),
      layer = from.split("/")[0] ?? "";
    const edges: string[] = [];
    const source = parsed.get(path);
    assert.ok(source, path);
    for (const edge of imports(source)) {
      const target = localTarget(path, edge.specifier);
      if (!target) continue;
      const to = name(target),
        next = to.split("/")[0] ?? "";
      if (!parsed.has(target) || target.endsWith(".test.ts"))
        problems.push(`${from} imports nonproduction ${to}`);
      edges.push(target);
      if (layer === next || next === "util" || to === "version.ts") continue;
      let allowed =
        from === "main.ts"
          ? next === "cli" || to === "version.ts"
          : Boolean(allows[layer]?.includes(next));
      if (layer === "state") allowed &&= edge.typeOnly;
      if (layer === "modules") allowed &&= edge.typeOnly;
      if (layer === "config")
        allowed &&= edge.typeOnly && /^modules\/[^/]+\/api\.ts$/.test(to);
      if (layer === "report" && next === "review")
        allowed &&= edge.typeOnly && to.startsWith("review/ingest/");
      if (layer === "report" && next === "modules")
        allowed &&= to.startsWith("modules/aspect/");
      if (layer === "install" && next === "modules")
        allowed &&= to.startsWith("modules/harness/");
      if (!allowed)
        problems.push(`${from} -> ${to}${edge.typeOnly ? " (type)" : ""}`);
    }
    graph.set(path, edges);
  }
  problems.push(...cycles(graph).map((cycle) => cycle.map(name).join(" -> ")));
  assert.deepEqual(problems, []);
});

test("process boundaries, harness registry ownership and the single Ajv are enforced by syntax", () => {
  const problems: string[] = [],
    ajv: string[] = [];
  for (const path of production) {
    const file = name(path);
    const boundary =
      [
        "main.ts",
        "cli/factory.ts",
        "cli/io.ts",
        "review/owner/process.ts",
      ].includes(file) || /^modules\/harness\/[^/]+\/launcher\.ts$/.test(file);
    const source = parsed.get(path);
    assert.ok(source, path);
    for (const edge of imports(source))
      if (
        edge.specifier === "node:process" &&
        !edge.typeOnly &&
        !boundary &&
        file !== "cli/exit-codes.ts"
      )
        problems.push(`${file}: imported process bypasses injected runtime`);
    for (const edge of imports(source))
      if (
        edge.specifier === "ajv" &&
        !edge.typeOnly &&
        file !== "util/schema.ts"
      )
        problems.push(`${file}: Ajv belongs to util/schema.ts`);
    visit(source, (node) => {
      if (isNewExpression(node) && node.expression.getText(source) === "Ajv")
        ajv.push(file);
      if (
        isStringLiteralLikeNode(node) &&
        AGENTS.includes(node.text as never) &&
        !file.startsWith("modules/harness/")
      )
        problems.push(`${file}: harness literal ${node.text}`);
      if (isPropertyAccessExpression(node) || isElementAccessExpression(node)) {
        const owner = node.expression;
        const key = isPropertyAccessExpression(node)
          ? node.name.text
          : node.argumentExpression &&
              isStringLiteralLikeNode(node.argumentExpression)
            ? node.argumentExpression.text
            : "";
        if (isIdentifier(owner) && owner.text === "process") {
          if (key === "exitCode" && file !== "cli/exit-codes.ts")
            problems.push(`${file}: process.exitCode`);
          if (
            ["env", "cwd", "stdout", "stderr", "stdin"].includes(key) &&
            !boundary
          )
            problems.push(`${file}: process.${key}`);
          if (file.startsWith("cli/commands/"))
            problems.push(`${file}: command uses process`);
        }
        if (isIdentifier(owner) && owner.text === "console" && !boundary)
          problems.push(`${file}: console bypasses injected IO`);
      }
    });
  }
  assert.deepEqual(ajv, ["util/schema.ts"]);
  assert.deepEqual(problems, []);
});

test("each registry is complete, resources exist, and the source root contains only domain directories", () => {
  for (const [kind, ids] of [
    ["harness", AGENTS],
    ["aspect", ASPECT_IDS],
  ] as const) {
    const base = join(root, "src/modules", kind);
    const directories = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "common")
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(directories, [...ids].sort());
    for (const id of ids) {
      const required =
        kind === "harness"
          ? ["index.ts", "launcher.ts", "readme.md"]
          : ["index.ts", "rubric.md"];
      for (const resource of required)
        assert.ok(existsSync(join(base, id, resource)), `${id}/${resource}`);
    }
  }
  for (const id of AGENTS) assert.equal(HARNESSES[id].id, id);
  for (const id of ASPECT_IDS) assert.equal(ASPECTS[id].meta.id, id);
  assert.deepEqual(
    readdirSync(join(root, "src")).sort(),
    [
      "main.ts",
      "version.ts",
      "cli",
      "review",
      "modules",
      "report",
      "state",
      "config",
      "install",
      "util",
    ].sort(),
  );
  for (const obsolete of ["assets", "scripts", "bin"])
    assert.ok(!existsSync(join(root, obsolete)), obsolete);
});

test("source and test size limits and tool dependency boundaries remain bounded", () => {
  const problems: string[] = [];
  const tests = sourceFiles(join(root, "test"));
  const evaluations = sourceFiles(join(root, "eval")).filter(
    (path) =>
      !/^eval\/(?:\.generated\/|gepa\/\.venv\/)/.test(relative(root, path)),
  );
  for (const path of [
    ...paths,
    ...tests,
    ...sourceFiles(join(root, "tools")),
    ...evaluations,
  ]) {
    const lines = readFileSync(path, "utf8").trimEnd().split("\n").length;
    const limit = path.endsWith(".test.ts") ? 400 : 300;
    if (lines > limit)
      problems.push(`${relative(root, path)}: ${lines} > ${limit}`);
  }
  const testAst = parseSources(root, tests);
  for (const [path, source] of [...parsed, ...testAst]) {
    for (const edge of imports(source, false)) {
      const target = localTarget(path, edge.specifier);
      if (target && relative(root, target).startsWith("tools/"))
        problems.push(`${relative(root, path)} imports tools/`);
    }
  }
  assert.deepEqual(problems, []);
});
