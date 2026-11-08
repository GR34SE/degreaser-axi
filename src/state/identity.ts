import type { ReviewInput } from "../review/types.ts";
import { hash } from "../util/hash.ts";

/** Attachment and scheduling controls do not describe the code being reviewed. */
export function reviewIdentity(input: ReviewInput, prompts: (string | null)[]) {
  return hash(
    JSON.stringify({
      repository: input.repository,
      scope: input.scope,
      baseRef: input.baseRef,
      pathPatterns: input.pathPatterns,
      base: input.base,
      tree: input.tree,
      paths: input.paths,
      excludedPaths: input.excludedPaths,
      patch: input.patch,
      task: input.task,
      dismissed: input.dismissed,
      assignments: input.config.assignments,
      prompts,
    }),
  );
}
