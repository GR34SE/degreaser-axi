import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

test("schemas do no import-time resource IO, register references before compilation and cache files across fragments", (t) => {
  const root = mkdtempSync(join(tmpdir(), "degreaser-schema-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const definitions = [
    {
      $id: "https://fixture.invalid/entry",
      type: "object",
      required: ["value"],
      properties: {
        value: { $ref: "https://fixture.invalid/reference#/definitions/value" },
      },
      additionalProperties: false,
    },
    {
      $id: "https://fixture.invalid/reference",
      definitions: {
        value: { $ref: "https://fixture.invalid/text" },
      },
    },
    { $id: "https://fixture.invalid/text", type: "string", minLength: 2 },
  ];
  const urls = definitions.map((definition, index) => {
    const path = join(root, `${index}.schema.json`);
    writeFileSync(path, JSON.stringify(definition));
    return pathToFileURL(path).href;
  });
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import {syncBuiltinESMExports} from "node:module";
    const original = fs.readFileSync;
    let reads = 0;
    fs.readFileSync = (path, ...args) => {
      if (String(path).endsWith(".schema.json")) reads++;
      return original(path, ...args);
    };
    syncBuiltinESMExports();
    const {schema} = await import(${JSON.stringify(new URL("./schema.ts", import.meta.url).href)});
    assert.equal(reads, 0, "import must not read packaged resources");
    const urls = ${JSON.stringify(urls)}.map(url => new URL(url));
    const validate = schema(urls[0], urls.slice(1));
    assert.equal(reads, 3);
    assert.equal(validate({value:"ok"}), true);
    assert.equal(validate({value:"x"}), false);
    assert.equal(validate({value:12}), false);
    assert.equal(validate({value:"ok", unexpected:true}), false);
    fs.writeFileSync(urls[0], "{");
    assert.equal(schema(urls[0], urls.slice(1))({value:"ok"}), true);
    const fragment = schema(new URL(urls[1].href + "#/definitions/value"), urls);
    assert.equal(fragment("ok"), true);
    assert.equal(fragment("x"), false);
    assert.equal(reads, 3, "cached files are shared by fragment validators");
  `,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
