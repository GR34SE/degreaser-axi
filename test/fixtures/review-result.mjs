function verdict(candidate, planned = "upheld") {
  if (planned === "omit") return [];
  const fields = typeof planned === "string" ? { verdict: planned } : planned;
  const upheld = (fields.verdict ?? "upheld") === "upheld";
  return [
    {
      candidate,
      verdict: "upheld",
      reason: upheld
        ? "The source confirms the candidate."
        : "The source refutes the candidate.",
      ...(upheld ? { action: "Remove it." } : {}),
      ...fields,
    },
  ];
}

const verdicts = (step, aspect, candidates) => ({
  aspect,
  status: "verdicts",
  verdicts: Array.from({ length: candidates }, (_, i) =>
    verdict(i + 1, step.verdicts?.[i]),
  ).flat(),
  limitations: [],
});

const examined = (result, stage, paths) =>
  stage === "find" && typeof result === "object" && !("examinedPaths" in result)
    ? { ...result, examinedPaths: paths }
    : result;

export async function sendResult(
  connection,
  sessionId,
  plan,
  step,
  aspect,
  { stage, candidates, paths },
) {
  const result = examined(
    step.result ??
      (stage === "verify"
        ? verdicts(step, aspect, candidates)
        : (plan.results?.[aspect] ?? {
            aspect,
            status: "no-findings",
            findings: [],
            limitations: [],
          })),
    stage,
    paths,
  );
  const text =
    typeof result === "string"
      ? result
      : `<degreaser-result>${JSON.stringify(result)}</degreaser-result>`;
  await connection.sessionUpdate({
    sessionId,
    update: plan.toolOnly
      ? {
          sessionUpdate: "tool_call",
          toolCallId: "synthetic",
          title: "Synthetic tool",
          kind: "read",
          status: "completed",
          content: [{ type: "content", content: { type: "text", text } }],
        }
      : {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
  });
}
