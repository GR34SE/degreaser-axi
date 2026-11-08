import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  isCallExpression,
  isExportDeclaration,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isNamedExports,
  isNamedImports,
  isStringLiteralLikeNode,
  isTemplateExpression,
  type Node,
  type SourceFile,
  SyntaxKind,
} from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

export const sourceFiles = (directory: string) =>
  readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:ts|mjs)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();

export function parseSources(root: string, paths: string[]) {
  const api = new API({ cwd: root });
  try {
    const config = join(root, "tsconfig.json");
    const snapshot = api.updateSnapshot({
      openProjects: [config],
      openFiles: paths,
    });
    const files = new Map<string, SourceFile>();
    for (const path of paths) {
      const project = snapshot.getDefaultProjectForFile(path);
      assert.ok(project, path);
      const source = project.program.getSourceFile(path);
      assert.ok(source, `Cannot parse ${relative(root, path)}`);
      assert.deepEqual(project.program.getSyntacticDiagnostics(path), [], path);
      files.set(path, source);
    }
    return files;
  } finally {
    api.close();
  }
}

export function visit(node: Node, visitor: (node: Node) => void) {
  visitor(node);
  node.forEachChild((child) => {
    visit(child, visitor);
  });
}

export interface ImportEdge {
  specifier: string;
  typeOnly: boolean;
}
export function imports(
  source: SourceFile,
  requireLiteral = true,
): ImportEdge[] {
  const edges: ImportEdge[] = [];
  visit(source, (node) => {
    if (isImportDeclaration(node) || isExportDeclaration(node)) {
      const value = node.moduleSpecifier;
      const bindings = isImportDeclaration(node)
        ? node.importClause?.namedBindings
        : node.exportClause;
      const namedTypes = Boolean(
        bindings &&
          (isNamedImports(bindings) || isNamedExports(bindings)) &&
          bindings.elements.length &&
          bindings.elements.every((part) => part.isTypeOnly),
      );
      if (value && isStringLiteralLikeNode(value))
        edges.push({
          specifier: value.text,
          typeOnly: isImportDeclaration(node)
            ? node.importClause?.phaseModifier === SyntaxKind.TypeKeyword ||
              (!node.importClause?.name && namedTypes)
            : node.isTypeOnly || namedTypes,
        });
    } else if (
      isCallExpression(node) &&
      node.expression.kind === SyntaxKind.ImportKeyword
    ) {
      const value = node.arguments[0];
      if (
        value &&
        isTemplateExpression(value) &&
        value.head.text.startsWith("data:")
      )
        return;
      if (value && !isStringLiteralLikeNode(value) && !requireLiteral) {
        // Runtime fixture URLs are external; retain relative literals inside computed URLs.
        visit(value, (part) => {
          if (
            isStringLiteralLikeNode(part) &&
            (part.text.startsWith("./") || part.text.startsWith("../"))
          )
            edges.push({ specifier: part.text, typeOnly: false });
        });
        return;
      }
      assert.ok(
        value && isStringLiteralLikeNode(value),
        `Nonliteral import in ${source.fileName}`,
      );
      edges.push({ specifier: value.text, typeOnly: false });
    } else if (
      isImportTypeNode(node) &&
      isLiteralTypeNode(node.argument) &&
      isStringLiteralLikeNode(node.argument.literal)
    ) {
      edges.push({ specifier: node.argument.literal.text, typeOnly: true });
    }
  });
  return edges;
}

export function localTarget(from: string, specifier: string) {
  if (!specifier.startsWith(".")) return null;
  return resolve(dirname(from), specifier).replace(/\.js$/, ".ts");
}

export function cycles(graph: Map<string, string[]>) {
  const active: string[] = [],
    done = new Set<string>(),
    found: string[][] = [];
  const search = (path: string) => {
    const index = active.indexOf(path);
    if (index !== -1) {
      found.push([...active.slice(index), path]);
      return;
    }
    if (done.has(path)) return;
    active.push(path);
    for (const next of graph.get(path) ?? []) search(next);
    active.pop();
    done.add(path);
  };
  for (const path of graph.keys()) search(path);
  return found;
}
