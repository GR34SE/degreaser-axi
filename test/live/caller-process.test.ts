import assert from "node:assert/strict";
import { test } from "node:test";
import { callerProcess } from "./support/caller-process.ts";

test("native test driver joins a child and rejects pending requests on early exit", async () => {
  const host = callerProcess(
    process.execPath,
    ["-e", "process.stdin.once('data',()=>process.exit(7))"],
    process.cwd(),
    () => {},
  );
  try {
    await assert.rejects(
      host.request({ id: 1 }, () => false),
      /closed \(7\)/,
    );
  } finally {
    await host.close();
  }
});

test("native observer failure rejects instead of crashing or leaving a child", async () => {
  const host = callerProcess(
    process.execPath,
    [
      "-e",
      'process.stdin.once("data",()=>console.log("{}"));setInterval(()=>{},1000)',
    ],
    process.cwd(),
    () => {
      throw new Error("observer refused");
    },
  );
  try {
    await assert.rejects(
      host.request({ id: 1 }, () => true),
      /observer refused/,
    );
  } finally {
    await host.close();
  }
});

test("missing native executable rejects and still joins cleanly", async () => {
  const host = callerProcess(
    "/nonexistent/degreaser-native-test",
    [],
    process.cwd(),
    () => {},
  );
  try {
    await assert.rejects(
      host.request({ id: 1 }, () => false),
      /ENOENT/,
    );
  } finally {
    await host.close();
  }
});

test("native stdin closure rejects a request without an unhandled stream error", async () => {
  const host = callerProcess(
    process.execPath,
    [
      "-e",
      'require("node:fs").closeSync(0);console.log(JSON.stringify({ready:true}));setTimeout(()=>{},500)',
    ],
    process.cwd(),
    () => {},
  );
  try {
    await host.wait((e) => e.ready === true);
    await assert.rejects(
      host.request({ id: 1 }, () => false),
      /EPIPE/,
    );
  } finally {
    await host.close();
  }
});

test("an isolated native check receives only the supplied environment", async () => {
  const host = callerProcess(
    process.execPath,
    [
      "-e",
      'process.stdin.once("data",()=>console.log(JSON.stringify({home:process.env.HOME,token:process.env.DEGREASER_TEST_TOKEN,path:process.env.PATH})))',
    ],
    process.cwd(),
    () => {},
    { HOME: "/synthetic/disposable-home", DEGREASER_TEST_TOKEN: "fixture" },
  );
  try {
    assert.deepEqual(await host.request({}, () => true), {
      home: "/synthetic/disposable-home",
      token: "fixture",
    });
  } finally {
    await host.close();
  }
});
