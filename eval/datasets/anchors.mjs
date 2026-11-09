import {
  getLeadingCommentRanges,
  getTrailingCommentRanges,
  SyntaxKind,
} from "typescript/unstable/ast";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

export function uniqueSnippetRange(source, snippet) {
  if (
    typeof source !== "string" ||
    typeof snippet !== "string" ||
    !snippet.trim()
  )
    return null;
  const lines = source.split("\n").map((line) => line.trim());
  const needle = snippet
    .trim()
    .split("\n")
    .map((line) => line.trim());
  const matches = [];
  for (let index = 0; index <= lines.length - needle.length; index++) {
    if (needle.every((line, offset) => line === lines[index + offset])) {
      matches.push([index + 1, index + needle.length]);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

export function stripLocalization(tagged, raw, tag = "original") {
  if (typeof tagged !== "string" || typeof raw !== "string") return null;
  const marker = new RegExp(`</?${tag}>`, "gu");
  let stripped = "";
  let previous = 0;
  let start = null;
  const spans = [];
  for (const match of tagged.matchAll(marker)) {
    stripped += tagged.slice(previous, match.index);
    if (match[0] === `<${tag}>`) {
      if (start !== null) return null;
      start = stripped.length;
    } else {
      if (start === null || stripped.length === start) return null;
      spans.push([start, stripped.length]);
      start = null;
    }
    previous = match.index + match[0].length;
  }
  stripped += tagged.slice(previous);
  if (start !== null || stripped !== raw || spans.length === 0) return null;
  // Keep raw physical coordinates. Multiple tagged fragments on one physical
  // line are one coarse localization unit, not dozens of fictitious issues.
  const ranges = spans.map(([from, to]) => [
    raw.slice(0, from).split("\n").length,
    raw.slice(0, to - 1).split("\n").length,
  ]);
  return mergeRanges(ranges);
}

export function mergeRanges(ranges) {
  const merged = [];
  for (const [start, end] of ranges.sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  )) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

export function oldDiffRanges(patch) {
  return [
    ...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gmu),
  ].flatMap((match) => {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    return count ? [[start, start + count - 1]] : [];
  });
}

export function comments(source) {
  const path = "/dataset-comments/source.ts";
  const config = "/dataset-comments/tsconfig.json";
  const fs = createVirtualFileSystem({
    [path]: source,
    [config]: JSON.stringify({
      compilerOptions: { noResolve: true, noLib: true, types: [] },
      files: ["source.ts"],
    }),
  });
  // Parse only in-memory text, never an imported project's configuration/code.
  const api = new API({
    cwd: "/dataset-comments",
    fs: {
      ...fs,
      readFile: (name) => fs.readFile(name) ?? null,
    },
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
    if (!file || project.program.getSyntacticDiagnostics(path).length) {
      throw new Error("Cannot parse source for comment localization");
    }
    visit(file);
  } finally {
    api.close();
  }
  const blocks = [...spans.values()]
    .sort((a, b) => a.pos - b.pos)
    .map((range) => ({
      text: source.slice(range.pos, range.end),
      start: source.slice(0, range.pos).split("\n").length,
      end: source.slice(0, range.end - 1).split("\n").length,
      kind: range.kind,
    }));
  const grouped = [];
  for (const block of blocks) {
    const previous = grouped.at(-1);
    if (
      previous &&
      previous.kind === SyntaxKind.SingleLineCommentTrivia &&
      block.kind === previous.kind &&
      block.start === previous.end + 1
    ) {
      previous.text += `\n${block.text}`;
      previous.end = block.end;
    } else grouped.push({ ...block });
  }
  return grouped;
}

export function commentLabels(before, after, changedRanges, path) {
  const remaining = new Set(comments(after).map((comment) => comment.text));
  const report = [];
  for (const comment of comments(before)) {
    if (remaining.has(comment.text)) continue;
    const label = {
      id: `${path}:${comment.start}-${comment.end}`,
      path,
      lines: [comment.start, comment.end],
      aspects: ["low-value-comments"],
    };
    if (
      Array.from(
        { length: comment.end - comment.start + 1 },
        (_, i) => comment.start + i,
      ).every((line) =>
        changedRanges.some(([start, end]) => line >= start && line <= end),
      )
    ) {
      report.push(label);
    }
  }
  return { report, preserve: [], forbidden: [] };
}
