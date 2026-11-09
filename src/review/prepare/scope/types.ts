export type Scope = "worktree" | "branch" | "repository";
export interface ScopePath {
  path: string;
  oldPath: string | null;
  status: string;
  oldMode: string | null;
  newMode: string | null;
  oldOid: string | null;
  newOid: string | null;
  binary: boolean;
  oldLink?: string;
  newLink?: string;
}
export interface Limitation {
  code: string;
  message: string;
  paths?: string[];
}
export interface ResolvedScope {
  base: string | null;
  tree: string;
  paths: ScopePath[];
  excludedPaths: string[];
  patch: string | null;
  limitations: Limitation[];
}
