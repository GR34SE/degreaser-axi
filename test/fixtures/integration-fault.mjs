// Synthetic filesystem boundary faults, not native consumer behavior.
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  if (process.env.INTEGRATION_FAIL_RC && to.endsWith("/.degreaserrc.json"))
    throw Object.assign(new Error("synthetic write refusal"), {
      code: "EACCES",
    });
  const result = rename.call(this, from, to);
  if (process.env.INTEGRATION_EDIT_TARGET && to.endsWith("/SKILL.md"))
    fs.writeFileSync(
      process.env.INTEGRATION_EDIT_TARGET,
      '{"userEdit":true}\n',
    );
  return result;
};
syncBuiltinESMExports();
