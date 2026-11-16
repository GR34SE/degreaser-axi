export const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  examinedPaths: [],
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
});
