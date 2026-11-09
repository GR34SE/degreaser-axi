import { readdirSync } from "node:fs";
import { dirname, relative } from "node:path";
import type { Agent } from "../../modules/harness/api.ts";
import { hash } from "../../util/hash.ts";
import type { Receipt } from "../receipt.ts";
import {
  conflict,
  type IntegrationEdits,
  readIntegrationLink,
} from "../transaction.ts";

export type SkillInstall = "copy" | "link";

export function planLinkedSkill(
  agent: Agent,
  edits: IntegrationEdits,
  receipt: Receipt,
  skillFile: string,
  shared: string,
  options: {
    link: boolean;
    remove: boolean;
    replace: ReadonlySet<string>;
    content: string;
  },
): { skipFile: boolean; fileBelowRemovedLink: boolean } {
  const dir = dirname(skillFile);
  const current = readIntegrationLink(dir);
  const isLink = current !== null && current !== "";
  const target = relative(dirname(dir), dirname(shared));
  const ownedLink =
    isLink &&
    ((receipt.files[dir]?.hash === hash(`symlink:${current}`) &&
      receipt.files[dir]?.owners.includes(agent)) ||
      (options.remove && !receipt.files[dir] && current === target));
  if (options.remove || !options.link) {
    const sharedOwner = receipt.files[shared];
    if (sharedOwner?.owners.includes(agent)) {
      sharedOwner.owners = sharedOwner.owners.filter((o) => o !== agent);
      if (!sharedOwner.owners.length) {
        const before = edits.read(shared);
        if (
          before !== null &&
          hash(before) !== sharedOwner.hash &&
          (options.remove || !options.replace.has(shared))
        )
          conflict(shared, !options.remove);
        delete receipt.files[shared];
        edits.set(shared, null);
      }
    }
    if (!isLink) return { skipFile: false, fileBelowRemovedLink: false };
    if (!ownedLink && !options.replace.has(dir)) conflict(dir, !options.remove);
    edits.link(dir, null);
    delete receipt.files[dir];
    return { skipFile: options.remove, fileBelowRemovedLink: true };
  }
  if (current !== target) {
    if (isLink && !ownedLink && !options.replace.has(dir)) conflict(dir, true);
    if (current === "") {
      if (readdirSync(dir).some((entry) => entry !== "SKILL.md")) conflict(dir);
      const before = edits.read(skillFile);
      const owned = receipt.files[skillFile];
      if (
        before !== null &&
        owned?.hash !== hash(before) &&
        before !== options.content &&
        !options.replace.has(skillFile)
      )
        conflict(skillFile, true);
      if (before !== null) edits.set(skillFile, null);
      if (owned) {
        owned.owners = owned.owners.filter((o) => o !== agent);
        if (!owned.owners.length) delete receipt.files[skillFile];
      }
    }
    edits.link(dir, target);
  }
  receipt.files[dir] = { hash: hash(`symlink:${target}`), owners: [agent] };
  return { skipFile: true, fileBelowRemovedLink: false };
}
