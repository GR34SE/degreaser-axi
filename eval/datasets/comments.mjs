import {
  getLeadingCommentRanges,
  getTrailingCommentRanges,
  SyntaxKind,
} from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

export function oldDiffRanges(patch) {
  return [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gmu),
  ].flatMap((match) => {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    return count ? [[start, start + count - 1]] : [];
  });
}

function comments(source) {
  const path = "/dataset-comments/source.ts";
  const config = "/dataset-comments/tsconfig.json";
  const fs = createVirtualFileSystem({
    [path]: source,
    [config]: JSON.stringify({
      compilerOptions: { noResolve: true, noLib: true, types: [] },
      files: ["source.ts"],
    }),
  });
  const api = new API({
    cwd: "/dataset-comments",
    fs: { ...fs, readFile: (name) => fs.readFile(name) ?? null },
  });
  const spans = new Map();
  const visit = (node) => {
    for (const range of [
      ...(getLeadingCommentRanges(source, node.pos) ?? []),
      ...(getTrailingCommentRanges(source, node.end) ?? []),
    ])
      spans.set(range.pos, range);
    node.forEachChild(visit);
  };
  try {
    const snapshot = api.updateSnapshot({
      openProjects: [config],
      openFiles: [path],
    });
    const project = snapshot.getDefaultProjectForFile(path);
    const file = project?.program.getSourceFile(path);
    if (!file || project.program.getSyntacticDiagnostics(path).length)
      throw new Error("Cannot parse source for comment localization");
    visit(file);
  } finally {
    api.close();
  }
  const line = (offset) => source.slice(0, offset).split("\n").length;
  const grouped = [];
  for (const range of [...spans.values()].sort((a, b) => a.pos - b.pos)) {
    const block = {
      text: source.slice(range.pos, range.end),
      start: line(range.pos),
      end: line(range.end - 1),
      kind: range.kind,
    };
    const previous = grouped.at(-1);
    if (
      previous?.kind === SyntaxKind.SingleLineCommentTrivia &&
      block.kind === previous.kind &&
      block.start === previous.end + 1
    ) {
      previous.text += `\n${block.text}`;
      previous.end = block.end;
    } else grouped.push(block);
  }
  return grouped;
}

export function commentLabels(before, after, changedRanges, path) {
  const remaining = new Set(comments(after).map((comment) => comment.text));
  const touched = (line) =>
    changedRanges.some(([start, end]) => line >= start && line <= end);
  const report = [];
  const preserve = [];
  for (const { text, start, end } of comments(before)) {
    const lines = Array.from({ length: end - start + 1 }, (_, i) => start + i);
    const label = (kind) => ({
      id: `${path}:${kind}${start}-${end}`,
      path,
      lines: [start, end],
      aspects: ["low-value-comments"],
    });
    if (!remaining.has(text)) {
      if (lines.every(touched)) report.push(label(""));
    } else if (!lines.some(touched)) preserve.push(label("keep:"));
  }
  return { report, preserve };
}
