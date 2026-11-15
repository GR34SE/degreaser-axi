# Stale references

`stale-references` · default ON

**Question:** Did the change leave repository text untrue, or silently drop a rule it did not ask to remove?

**Applies when:** The change removes, renames, adds to or changes a file, path, flag, option, environment variable, command, exported name, configuration key, value, enumerated set or documented behavior, or rewrites documentation, instructions, prompts or help text. In a repository audit, assess whether the assessed text still matches the source it describes. Otherwise return not-applicable.

**Rule:** Text that people or coding agents read to learn how the code works must stay true after the change. Report text the change made false: documentation, comments, help text, examples, descriptive configuration such as `.env.example`, prompts or instructions that still name a removed or renamed file, flag, variable, command, function or value; a mirrored copy of a value, count or version that still states the old value of the same thing; an exhaustive list, table or enumeration in such text that now omits a member the change added to the same set; a rewritten instruction, prompt or document that silently drops a rule or its reason the task did not ask to remove; and a link, path or anchor in changed or affected text that now resolves to nothing. Readers treat such text as authority, so it sends them to commands that fail, values that no longer hold and rules that no longer apply.

**Evidence:** List what the change removed, renamed or changed. Search the repository for each old name, path, value and anchor, including documentation, comments, help text, examples, descriptive configuration, skills and agent instructions. Read each match in context and establish that it describes the same thing the change altered, not a homonym or an independent value. A finding must cite an assessed path: cite the stale text directly when it lies in an assessed path; otherwise cite the line of the change that made it false, often the removed line on the `old` side, and list each stale location as `path:line` with its exact wording in `evidence`. For a dropped rule, quote the removed rule on the `old` side and show that neither the task nor the new text keeps it; a repository audit has no `old` side, so do not check for dropped rules there. For a broken link or path, name the target that no longer exists. Report one change's stale mentions as one finding with every location. A search without matches does not prove that no stale text exists. With `no-findings`, name in `limitations` the search roots and names you checked.

**Boundaries:** Preserve dated history, changelog and release-note entries, migration notes that say something was removed or renamed, and aliases that still work. Intentionally independent text is not a mirror: generated or vendored copies, fixtures that pin an old form on purpose, and other packages, services or protocols with a same-looking value. For generated text, report the source that generates it, unless the committed output ships and the change left it stale. A removal or rewording the task requires is not a dropped rule, and a rule restated in different words survives. Text outside the repository, such as external sites, is not evidence. References that code or tooling consume, such as manifest entry points, exports maps, registrations and configuration keys read by code, are not text for readers.

**Not here (another reviewer):**
- A reference consumed by code or tooling, such as a manifest entry point, exports map, registration or configuration key read by code, that now breaks the runtime path, and required new code that is not connected to the user path: incomplete-integration. Text read by people or agents that still describes what the change removed or renamed stays here.
- An accurate comment that narrates code or prevents no hidden trap: low-value-comments. A comment the change made false stays here.
- Unrequested features, permissions or refactoring added by the change: scope-creep. A rule silently dropped from rewritten text stays here.

Sources / inspiration: product-specific inference that text made false by a change misleads the people and agents who treat it as authority. Teaching excerpts; context states omitted setup. These have not been executed as programs or model evaluations.

## stale-references-B1 · REPORT

**Context:** The change renames the environment variable `APP_DB_URL` to `DATABASE_URL` in `settings.py`, which now reads only the new name and fails at startup when it is missing. `.env.example`, which the setup guide tells developers to copy, is unchanged.

```sh
# .env.example
APP_DB_URL=postgres://localhost:5432/app
```

**Why:** A developer who follows the setup guide sets a variable nothing reads and the application fails to start. Cite the removed `APP_DB_URL` read on the `old` side of `settings.py`, list the `.env.example` line in evidence, and rename the example variable.

## stale-references-B2 · REPORT

**Context:** The change raises the upload retry limit from 3 to 5 in `config.ts`. The unchanged help text in `cli/help.ts` describes the same limit and does not derive from the constant.

```typescript
// config.ts
export const MAX_UPLOAD_RETRIES = 5;

// cli/help.ts
"--retry  Retry failed uploads (up to 3 times)",
```

**Why:** Both lines describe one setting, so the help now states a limit the program no longer applies. Derive the help text from the constant or update it in the same change.

## stale-references-B3 · REPORT

**Context:** The task asks to shorten `AGENTS.md` without changing its rules. The rewrite drops the rule against committing to `main` together with its reason, and no other line in the new file or the files it links states it.

```markdown
Before:
- Never commit directly to main; CI only gates pull requests.
- Run the tests before pushing.

After:
- Run the tests before pushing.
```

**Why:** Agents that read the new file lose a rule and the reason it exists, although the task asked only for brevity. Quote the removed line on the `old` side and restore the rule in the shortened form.

## stale-references-G1 · PRESERVE

**Context:** The change removes the `--legacy` flag and adds a changelog entry. An older release entry still names the flag.

```markdown
- 2.0.0: Removed `--legacy`; use `--format compat` instead.
- 1.4.0: Added `--legacy` for the previous output format.
```

**Why:** Dated history and migration notes describe the past truthfully. Rewriting them would erase the record users need when upgrading.

## stale-references-G2 · PRESERVE

**Context:** The change raises the HTTP client's request timeout from 30 to 60 seconds in `client.ts`. `worker/queue.ts` also contains 30, but it is the message queue's visibility timeout, set by that service's contract and unrelated to HTTP requests.

```typescript
// worker/queue.ts
export const VISIBILITY_TIMEOUT_SECONDS = 30;
```

**Why:** A matching literal is not a mirrored copy. The constant describes a different setting, and changing it would alter unrelated queue behavior. Searching for the old value finds candidates; it does not establish staleness.

## stale-references-G3 · PRESERVE

**Context:** The task asks to shorten `AGENTS.md`. The rewrite merges two lines and keeps both the rule against committing to `main` and its reason.

```markdown
Before:
- Never commit directly to main.
- CI only gates pull requests, so direct commits skip it.

After:
- Never commit to main: CI only gates pull requests.
```

**Why:** The rule and its reason survive in different words. A removed line is not a dropped rule when the new text still states it.
