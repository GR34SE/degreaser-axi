import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import { Ajv } from "ajv";
import { configSchema, GitHub, Manifest, manifestSchema } from "release-please";
import { parseConventionalCommits } from "release-please/build/src/commit.js";
import { buildStrategy } from "release-please/build/src/factory.js";
import { TagName } from "release-please/build/src/util/tag-name.js";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("release configuration is accepted by Release Please and starts at v1", async (t) => {
  const config = JSON.parse(read("release-please-config.json"));
  const validate = new Ajv({ strict: false, validateFormats: false }).compile(
    configSchema,
  );
  assert.equal(validate(config), true, JSON.stringify(validate.errors));
  assert.equal(
    new Ajv({ strict: false }).validate(
      manifestSchema,
      JSON.parse(read(".release-please-manifest.json")),
    ),
    true,
  );
  const strategy = await releaseStrategy(t);
  const candidate = await strategy.buildReleasePullRequest(
    parseConventionalCommits([
      { sha: "a".repeat(40), message: "feat: ship the initial release" },
    ]),
  );
  assert.equal(candidate?.version?.toString(), "1.0.0");
});

test("Release Please maps dependency fixes to patches without hiding features or breaking changes", async (t) => {
  const strategy = await releaseStrategy(t);
  const tag = TagName.parse("v1.0.8");
  assert.ok(tag);
  const latest = { tag, sha: "b".repeat(40), notes: "Previous release" };
  for (const [message, expected] of [
    ["fix(deps): update acpx to 0.22.0", "1.0.9"],
    ["feat: add a command", "1.1.0"],
    ["fix!: change the public result contract", "2.0.0"],
    ["chore(deps): update the formatter", undefined],
  ] as const) {
    const candidate = await strategy.buildReleasePullRequest(
      parseConventionalCommits([{ sha: "a".repeat(40), message }]),
      latest,
    );
    assert.equal(candidate?.version?.toString(), expected, message);
    if (!candidate) continue;
    const packageUpdate = candidate.updates.find(
      (update) => update.path === "package.json",
    );
    const cliUpdate = candidate.updates.find(
      (update) => update.path === "src/version.ts",
    );
    assert.ok(packageUpdate);
    assert.ok(cliUpdate);
    const manifest = JSON.parse(
      packageUpdate.updater.updateContent(read("package.json")),
    );
    const cli = await import(
      `data:text/javascript,${encodeURIComponent(
        cliUpdate.updater.updateContent(read("src/version.ts")),
      )}`
    );
    assert.equal(manifest.version, expected);
    assert.equal(cli.VERSION, expected);
  }
});

async function releaseStrategy(t: TestContext) {
  const github = await GitHub.create({
    owner: "fixture",
    repo: "fixture",
    defaultBranch: "main",
    fetch: async () => {
      throw new Error("Release contract tests must not access GitHub.");
    },
  });
  t.mock.method(github, "getFileContentsOnBranch", async (path: string) => {
    const parsedContent = read(path);
    return {
      content: Buffer.from(parsedContent).toString("base64"),
      parsedContent,
      sha: "c".repeat(40),
    };
  });
  const manifest = await Manifest.fromManifest(github, "main");
  const config = manifest.repositoryConfig["."];
  assert.ok(config);
  return buildStrategy({ ...config, github, targetBranch: "main" });
}
