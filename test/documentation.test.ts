import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateConfig } from "../src/config.ts";
import { queueFixture } from "./queue-fixture.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const readme = readFileSync(resolve(root, "README.md"), "utf8");

test("public documentation links resolve for source readers without a build", () => {
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  const sourceFiles = new Set(tracked.stdout.split("\0"));
  for (const file of [
    "README.md",
    "assets/input-contract.md",
    "assets/result-contract.md",
    "assets/native-profiles.md",
    "assets/catalog.md",
  ]) {
    const path = resolve(root, file);
    const text = readFileSync(path, "utf8");
    for (const [, target] of text.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      const sourcePrefix = "https://github.com/GR34SE/degreaser-axi/blob/main/";
      if (target?.startsWith(sourcePrefix)) {
        assert.ok(sourceFiles.has(target.slice(sourcePrefix.length)), target);
        continue;
      }
      if (!target || /^(?:https?:|#)/.test(target)) continue;
      const resolved = resolve(
        dirname(path),
        decodeURIComponent(target.split("#")[0] ?? ""),
      );
      assert.ok(
        sourceFiles.has(resolved.slice(root.length)) && existsSync(resolved),
        `${file}: broken local link ${target}`,
      );
    }
  }
});

test("README configuration and neutral report excerpt match the public CLI", (t) => {
  const example = /```json\n([\s\S]+?)\n```/.exec(readme)?.[1];
  assert.ok(example);
  validateConfig(JSON.parse(example));
  const f = queueFixture(t);
  const quote = "// Return the sum of two numbers.";
  f.write(
    "sum.ts",
    `${quote}\nexport function sum(a: number, b: number) { return a + b; }\n`,
  );
  f.setPlan({
    results: {
      A06: {
        aspect: "A06",
        status: "findings",
        limitations: [],
        findings: [
          {
            location: { path: "sum.ts", side: "new", startLine: 1, endLine: 1 },
            quote,
            title: "Comment repeats the function",
            evidence: "Both say that the function adds numbers.",
            consequence: "Duplicate maintenance.",
            countercheck: "No hidden constraint is documented.",
            recommendation: "Remove the redundant comment.",
          },
        ],
      },
    },
  });
  f.start(["--aspects", "A06"]);
  assert.equal(f.finish().status, 0);
  const report = f.run(["report"]);
  assert.equal(report.status, 0);
  const excerpt = /```text\n([\s\S]+?)\n```/.exec(readme)?.[1];
  assert.ok(excerpt);
  assert.ok(report.stdout.includes(excerpt), report.stdout);
  const finding = f.run(["finding", "F1"]);
  assert.equal(finding.status, 0);
  assert.ok(finding.stdout.includes(quote));
});

test("private local material is ignored and absent from tracked files", () => {
  const paths = [
    "specs/README.md",
    ".lavish/session.json",
    ".degreaser/runs/example/run.json",
    ".references/backpass/README.md",
    ".env",
    ".env.local",
    "build-output.tgz",
    "coverage/report.html",
    "dist/bin/degreaser-axi.js",
    "node_modules/example/index.js",
  ];
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: `${paths.join("\n")}\n`,
  });
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.deepEqual(ignored.stdout.trim().split("\n"), paths);
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(tracked.status, 0, tracked.stderr);
  for (const file of tracked.stdout.split("\0").filter(Boolean))
    assert.doesNotMatch(
      file,
      /(?:^|\/)(?:specs|\.lavish|\.degreaser|\.references|node_modules|dist|coverage|\.env(?:\.[^/]+)?)(?:\/|$)|\.tgz$/,
      file,
    );
});
