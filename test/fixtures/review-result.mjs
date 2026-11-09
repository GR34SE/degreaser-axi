export async function sendResult(
  connection,
  sessionId,
  plan,
  step,
  aspect,
  assessedPaths,
) {
  const planned = step.result ??
    plan.results?.[aspect] ?? {
      aspect,
      status: "no-findings",
      findings: [],
      limitations: [],
    };
  const result =
    typeof planned === "string"
      ? planned
      : { examinedPaths: assessedPaths(), ...planned };
  if (plan.toolOnly)
    await connection.sessionUpdate({
      sessionId: sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "synthetic",
        title: "Synthetic tool",
        kind: "read",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: result } }],
      },
    });
  else
    await connection.sessionUpdate({
      sessionId: sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text:
            typeof result === "string"
              ? result
              : "<degreaser-result>" +
                JSON.stringify(result) +
                "</degreaser-result>",
        },
      },
    });
}
