// ============ DNA planning-surface repo allow-list (DNA-9) ============
// The planning surface (Roadmap, Backlog, Issues) and the cron-config repo
// targets are locked to the DNA-relevant repos only:
//   - bemomentiq/momentiq-dna       (primary product repo)
//   - bemomentiq/momentiq-dna-hub   (this operator console)
// Extend this list if/when DNA splits into separate frontend/backend repos.
// This is the single source of truth shared by client (read-only repo picker)
// and server (cron-config validation, GitHub sync, planning-surface fetches).

export const ALLOWED_REPOS = [
  "bemomentiq/momentiq-dna",
  "bemomentiq/momentiq-dna-hub",
] as const;

export type AllowedRepo = (typeof ALLOWED_REPOS)[number];

// Safe defaults to coerce legacy / off-scope values back into the allow-list.
export const DEFAULT_BACKEND_REPO: AllowedRepo = "bemomentiq/momentiq-dna";
export const DEFAULT_HUB_REPO: AllowedRepo = "bemomentiq/momentiq-dna-hub";

// Type-guard: true iff `repo` is in the allow-list.
export function isAllowedRepo(repo: string | null | undefined): repo is AllowedRepo {
  return !!repo && (ALLOWED_REPOS as readonly string[]).includes(repo);
}

// Reduce a list of candidate repos to the allow-list, deduped, order preserved.
export function filterAllowedRepos(repos: (string | null | undefined)[]): AllowedRepo[] {
  const out: AllowedRepo[] = [];
  for (const r of repos) {
    if (isAllowedRepo(r) && !out.includes(r)) out.push(r);
  }
  return out;
}
