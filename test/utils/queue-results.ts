export const clean = {
  aspect: "low-value-comments",
  status: "no-findings",
  findings: [],
  limitations: [],
  examinedPaths: ["source.ts"],
};

export const cleanBlock = `<degreaser-result>${JSON.stringify(clean)}</degreaser-result>`;

export const atLimit = cleanBlock + "x".repeat(1_048_576 - cleanBlock.length);

export const oversized = `${atLimit}x`;

export const finding = {
  location: { path: "source.ts", side: "new", startLine: 1, endLine: 1 },
  quote: "// redundant",
  title: "Repeated comment",
  evidence: "The comment repeats the declaration.",
  consequence: "Extra maintenance.",
  countercheck: "No hidden rationale.",
  recommendation: "Remove it.",
};
