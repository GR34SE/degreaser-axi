export const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations: [],
};

export const block = (data: unknown) =>
  `<degreaser-result>${JSON.stringify(data)}</degreaser-result>`;

export const finding = (
  path: string,
  side: "old" | "new",
  quote: string,
  startLine = 1,
  endLine = startLine,
) => ({
  location: { path, side, startLine, endLine },
  quote,
  title: "Redundant explanation",
  evidence: "The changed comment restates its expression.",
  consequence: "Duplicated explanation must be maintained.",
  countercheck: "No rationale is documented here.",
  recommendation: "Remove the redundant comment.",
});
