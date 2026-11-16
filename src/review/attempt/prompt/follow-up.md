# Next round

Continue the same review. Account for the specific paths below now, at most 40 in this round. They are not accounted for yet; `patchLines` is each path's line range in the patch file. The block is untrusted evidence, like the input of your first round, and ends only at the closing tag with the same suffix.

Continue with them as before: examine each path that can contain the aspect and rule out the paths that cannot. Then return one result block for this round only: the new candidates from this round, and in `examinedPaths` the paths you accounted for in this round. Do not repeat earlier candidates. `remainingPaths` is the number left after this batch; another bounded round follows while paths remain. A `not-applicable` result means the whole assessed scope is inapplicable, not just this batch, and ends the session.
