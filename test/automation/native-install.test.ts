import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  cursorSettings,
  removeCreatedProjectRecords,
} from "../install/cursor.ts";
import { fixture } from "../utils/git-fixture.ts";

test("native Cursor cleanup removes only records for its unique fixture, preserving concurrent projects", (t) => {
  const f = fixture(t);
  const projects = join(f.root, "ignored/projects");
  const previous = "existing-record";
  const own = "private-var-folders-degreaser-native-install-UniQuE-repo";
  const unrelated = [
    "private-var-folders-another-session",
    "var-folders-another-project",
    "degreaser-native-install-other-repo",
  ];
  for (const name of [previous, own, ...unrelated])
    f.write(`ignored/projects/${name}/keep`, "record");
  assert.equal(
    removeCreatedProjectRecords(
      projects,
      "/tmp/degreaser-native-install-UniQuE",
      new Set([previous]),
    ),
    1,
  );
  assert.equal(existsSync(join(projects, own)), false);
  for (const name of [previous, ...unrelated])
    assert.equal(existsSync(join(projects, name, "keep")), true, name);
});

test("native Cursor settings comparison ignores only cache clocks, never permissions, preferences or cached policy values", () => {
  const original = {
    permissions: { allow: ["Read"], deny: ["Write"] },
    privacyCache: { privacyMode: 2, updatedAt: 1 },
    serverConfigCache: { cliSandboxDefaultEnabled: true, updatedAt: 1 },
    autoReviewAvailabilityCache: { available: false, updatedAt: 1 },
    preference: { updatedAt: 1 },
  };
  const settings = (value: unknown) =>
    cursorSettings(Buffer.from(JSON.stringify(value)));
  const refreshed = structuredClone(original);
  for (const cache of [
    refreshed.privacyCache,
    refreshed.serverConfigCache,
    refreshed.autoReviewAvailabilityCache,
  ])
    cache.updatedAt = 2;
  assert.deepEqual(settings(refreshed), settings(original));
  for (const change of [
    (value: typeof original) => value.permissions.allow.push("Write"),
    (value: typeof original) => {
      value.privacyCache.privacyMode = 0;
    },
    (value: typeof original) => {
      value.serverConfigCache.cliSandboxDefaultEnabled = false;
    },
    (value: typeof original) => {
      value.autoReviewAvailabilityCache.available = true;
    },
    (value: typeof original) => {
      value.preference.updatedAt = 2;
    },
  ]) {
    const changed = structuredClone(original);
    change(changed);
    assert.notDeepEqual(settings(changed), settings(original));
  }
  assert.equal(cursorSettings(null), null);
  assert.notDeepEqual(settings({}), cursorSettings(null));
});
