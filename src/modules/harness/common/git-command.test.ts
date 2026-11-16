import assert from "node:assert/strict";
import { test } from "node:test";
import { readOnlyGitViolation } from "./git-command.ts";

test("read-only git commands with plain arguments are allowed", () => {
  for (const command of [
    "git diff",
    "git diff --stat abc123...HEAD -- src/a.ts",
    "git log --oneline -n 20 --format=%H,%s main..HEAD",
    "git show HEAD~1:src/a.ts",
    "git blame -L 10,20 src/a.ts",
    "git status --porcelain",
    "git ls-files src",
    "git grep -n TODO -- src",
    "git cat-file -p HEAD^",
    "git merge-base main HEAD",
    "git rev-parse --show-toplevel",
    "  git   diff   HEAD  ",
    "git diff -Oorder.txt",
  ])
    assert.equal(readOnlyGitViolation(command), undefined, command);
});

test("other programs, subcommands, global options and shell syntax are rejected", () => {
  for (const command of [
    undefined,
    "",
    "git",
    "gh pr view",
    "/usr/bin/git diff",
    "git push",
    "git commit -m x",
    "git checkout -- a.ts",
    "git config core.pager cat",
    "git -c core.pager=sh diff",
    "git -C /tmp diff",
    "git --git-dir=/tmp/x log",
    "GIT_EXTERNAL_DIFF=sh git diff",
    "git diff && rm -rf src",
    "git diff; touch x",
    "git diff | tee x",
    "git log > out.txt",
    "git log $(touch x)",
    "git log `touch x`",
    "git log $HOME",
    "git grep 'a b'",
    'git grep "a"',
    "git diff\ntouch x",
    "git diff\ttouch",
    "git ls-files *.ts",
    "git log HEAD@{1}",
    "git diff & touch x",
  ])
    assert.ok(readOnlyGitViolation(command), String(command));
});

test("options that write files, start programs or read outside the repository are rejected", () => {
  for (const command of [
    "git diff --output=x.patch",
    "git diff --output x.patch",
    "git log --outp=x",
    "git show --ou=x HEAD",
    "git grep --open-files-in-pager=sh x",
    "git grep --op=sh x",
    "git grep -Osh x",
    "git grep -nOsh x",
    "git grep -O x",
    "git diff --no-index /etc/hosts /etc/passwd",
    "git grep --no-index -n root /etc",
    "git grep --no-i root /etc",
  ])
    assert.ok(readOnlyGitViolation(command), command);
});
