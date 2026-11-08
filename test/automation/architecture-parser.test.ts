import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cycles,
  imports,
  localTarget,
  parseSources,
} from "../utils/source-graph.ts";

test("architecture parsing ignores comments and text but retains named type, re-export, import-query and dynamic edges", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-graph-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(
    join(root, "tsconfig.json"),
    '{"compilerOptions":{"module":"NodeNext"},"include":["*.ts"]}',
  );
  const paths = ["a.ts", "b.ts", "computed.ts"].map((name) => join(root, name));
  writeFileSync(
    paths[0] ?? "",
    [
      '/* import "./not-an-import.ts"; */',
      "const text = \"import('./not-a-dependency.ts')\";",
      'import type {Item} from "./b.ts";',
      'import {type Item as Other} from "./b.ts";',
      'export type {Item} from "./b.ts";',
      'type Query = import("./b.ts").Item;',
      "const runtime = () => import(`./b.ts`);",
    ].join("\n"),
  );
  writeFileSync(
    paths[1] ?? "",
    'import type {Query} from "./a.ts"; export interface Item {}',
  );
  writeFileSync(
    paths[2] ?? "",
    "export const load = (name: string) => import(name);",
  );
  const parsed = parseSources(root, paths);
  const a = parsed.get(paths[0] ?? ""),
    b = parsed.get(paths[1] ?? ""),
    computed = parsed.get(paths[2] ?? "");
  assert.ok(a && b && computed);
  assert.deepEqual(
    imports(a),
    [true, true, true, true, false].map((typeOnly) => ({
      specifier: "./b.ts",
      typeOnly,
    })),
  );
  const graph = new Map(
    [...parsed]
      .filter(([, source]) => source !== computed)
      .map(([path, source]) => [
        path,
        imports(source).map((edge) => localTarget(path, edge.specifier) ?? ""),
      ]),
  );
  assert.deepEqual(cycles(graph), [[paths[0], paths[1], paths[0]]]);
  assert.throws(() => imports(computed), /Nonliteral import/);
});
