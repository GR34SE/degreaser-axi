import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseDocument } from "yaml";

const document = parseDocument(
  readFileSync(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  ),
  { uniqueKeys: true },
);
assert.deepEqual(document.errors, []);
const { publish } = document.toJS().jobs;
const registry = publish.steps.find(
  (step: { id?: string }) => step.id === "registry",
);

test("publication recovery accepts only missing or byte-identical npm versions", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "release"));
  const bytes = Buffer.from("independent tested artifact fixture\n");
  writeFileSync(join(root, "release/degreaser-axi-1.0.9.tgz"), bytes);
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  const preload = join(root, "registry.mjs");
  writeFileSync(
    preload,
    `globalThis.fetch = async (url) => {
      if (url !== "https://registry.npmjs.org/degreaser-axi/1.0.9")
        throw new Error("Unexpected registry URL: " + url);
      if (process.env.REGISTRY_STATUS === "network-error")
        throw new Error("Offline");
      return new Response(process.env.REGISTRY_BODY, {
        status: Number(process.env.REGISTRY_STATUS)
      });
    };`,
  );
  for (const [status, body, expected] of [
    ["404", "Not found", "publish=true\n"],
    ["200", JSON.stringify({ dist: { integrity } }), "publish=false\n"],
    ["200", JSON.stringify({ dist: { integrity: "sha512-wrong" } }), undefined],
    ["200", "invalid json", undefined],
    ["503", "Unavailable", undefined],
    ["network-error", "", undefined],
  ] as const) {
    const output = join(root, `output-${status}-${body.length}`);
    const result = spawnSync(
      "bash",
      ["-eu", "-o", "pipefail", "-c", registry.run],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          NODE_OPTIONS: `--import=${preload}`,
          RELEASE_TAG: "v1.0.9",
          GITHUB_OUTPUT: output,
          REGISTRY_STATUS: status,
          REGISTRY_BODY: body,
        },
      },
    );
    assert.equal(result.status === 0, expected !== undefined, result.stderr);
    assert.equal(
      existsSync(output) ? readFileSync(output, "utf8") : undefined,
      expected,
    );
  }
});
