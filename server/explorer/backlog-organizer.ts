// Shared Backlog Organizer module.
// Exposes three capabilities:
//   1. dispatchOrganizerToCC() — fire a CC task that runs the organizer briefing on a Mini
//   2. computeExplorerPauseDecision() — check open-cap + novelty-floor before dispatching Explorer
//   3. setExplorerPaused() — persist pause reason for UI visibility

import { storage } from "../storage";

const CC_API_URL = process.env.CC_API_URL ?? "https://command-center-api-production-96e2.up.railway.app";
const CC_API_KEY = process.env.CC_API_KEY ?? process.env.AGENT_API_KEY ?? "miq-cmd-center-2026";

const MINI_EXECUTORS = ["mini-1", "mini-2", "mini-3", "mini-4", "mini-5"];

function pickOrganizerExecutor(): string {
  // Hour-based round-robin — spreads load across the fleet
  const idx = Math.floor(Date.now() / (1800 * 1000)) % MINI_EXECUTORS.length;
  return MINI_EXECUTORS[idx];
}

export interface OrganizerScope {
  kind: "full_backlog" | "recent_only" | "inline_post_explorer";
  recent_since_iso?: string;
  max_issues?: number;
}

export interface OrganizerDispatchResult {
  ok: boolean;
  cc_task_id?: number;
  executor?: string;
  error?: string;
}

const ORGANIZER_BRIEFING = `## Goal
Run a full Backlog Organizer pass on the default GitHub repo.

## Context
This task is dispatched by the momentiq-dna-hub Backlog Organizer cron. It runs on a round-robin Mini and performs dedup, orphan absorption, phase-tracker ratification, and briefing optimization on open GitHub issues.

## Files
- Work entirely via GitHub CLI and Hub API. No source files to edit.

## Implementation
### Phase 1 — Fetch all open issues
\`\`\`bash
gh issue list -R {DEFAULT_REPO} --state open --limit 2000 --json number,title,body,labels,createdAt > /tmp/open-issues.json
wc -l /tmp/open-issues.json
\`\`\`

### Phase 2 — Dedup cluster
- For each issue, check title + first 200 chars of body for semantic duplicates against the 20 most similar issues.
- If a near-exact duplicate exists: CLOSE the newer one with: gh issue close <N> --reason "duplicate" --comment "Duplicate of #<older>"
- If a near-sibling (same theme, slightly different scope): COMMENT on both with "Sibling: #X — consider consolidating".

### Phase 3 — Ratify 6 phase trackers
Ensure exactly one open issue per phase exists labeled phase-tracker:
- Phase 0: Foundation & Auth
- Phase 1: Pipeline Core
- Phase 2: Frontend Wiring
- Phase 3: Test Coverage
- Phase 4: Eval & Drift
- Phase 5: Production Readiness
If any tracker is missing, create it with a standard body.

### Phase 4 — Briefing optimization
For each open issue missing required H2 headers (Goal, Context, Files, Implementation, Acceptance, Out-of-scope, Commit + PR, Notes):
- EDIT the body to add the missing H2 with a brief placeholder.
- Limit to 20 issues per organizer run to avoid rate limits.

### Phase 5 — Stats and Hub PATCH
Compute stats JSON and PATCH Hub cron_config:
\`\`\`bash
curl -X PATCH {HUB_BASE}/api/config \
  -H "Content-Type: application/json" \
  -d '{"organizer_last_run_at": "<ISO>", "organizer_last_stats_json": "<JSON>"}'
\`\`\`

### Phase 6 — Dynamic pause signal
Fetch the last 2 Explorer runs from Hub API. If combined draft_tasks_count + findings_count < 2 × novelty_floor, ALSO patch explorer_paused_reason.

## Acceptance
- Duplicate issues closed or flagged
- Phase trackers exist for all 6 phases
- Issues missing H2s patched (up to 20)
- Hub cron_config updated with organizer_last_run_at + organizer_last_stats_json

## Out-of-scope
- Do not close issues that are not clear duplicates (flag with comment instead)
- Do not modify source code in any repo
- Do not touch the consolidation cron or executor runs

## Commit + PR
- No source changes in this run — Hub/GitHub API only

## Notes
- Rate limit: max 50 GitHub API calls per run
- Dynamic pause: if explorer_paused_reason is set, also notify in summary`;

export async function dispatchOrganizerToCC(scope: OrganizerScope): Promise<OrganizerDispatchResult> {
  const cfg = storage.getCronConfig() as any;
  const executor = pickOrganizerExecutor();
  const now = new Date().toISOString();
  const scopeNote = scope.kind === "recent_only"
    ? ` (recent-only since ${scope.recent_since_iso ?? "1h ago"})`
    : scope.kind === "inline_post_explorer" ? " (inline post-explorer)" : "";

  const defaultRepo = cfg.default_gh_repo ?? "bemomentiq/momentiq-dna";
  const hubBase = process.env.NODE_ENV === "production"
    ? "https://momentiq-dna-hub.up.railway.app/port/5000"
    : "http://localhost:5000";
  const issueLimit = scope.max_issues ?? 2000;
  const ghListCmd = scope.kind === "recent_only" && scope.recent_since_iso
    ? `gh issue list -R ${defaultRepo} --state open --search "created:>=${scope.recent_since_iso}" --limit ${issueLimit} --json number,title,body,labels,createdAt > /tmp/open-issues.json`
    : `gh issue list -R ${defaultRepo} --state open --limit ${issueLimit} --json number,title,body,labels,createdAt > /tmp/open-issues.json`;
  const briefing = ORGANIZER_BRIEFING
    .replace(
      /gh issue list -R \{DEFAULT_REPO\} --state open --limit 2000 --json number,title,body,labels,createdAt > \/tmp\/open-issues\.json/,
      ghListCmd,
    )
    .replace(/{DEFAULT_REPO}/g, defaultRepo)
    .replace(/{HUB_BASE}/g, hubBase);

  const payload = {
    title: `[DNA-ORGANIZER-CRON] Backlog Organizer run ${now.slice(0, 16)}${scopeNote}`,
    description: `Automated backlog organizer dispatched by momentiq-dna-hub at ${now}. Scope: ${scope.kind}.`,
    agentBriefing: briefing,
    projectSlug: cfg.default_cc_project_slug ?? "momentiq-dna",
    repoUrl: "https://github.com/bemomentiq/momentiq-dna-hub",
    priority: "p2",
    taskType: "dev_task",
    automatable: true,
    executor,
    effortEstimate: "20 min",
  };

  try {
    const res = await fetch(`${CC_API_URL}/api/tasks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CC_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: `CC API ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    const data = (await res.json()) as any;
    const cc_task_id: number = data?.id ?? data?.task?.id;
    storage.updateCronConfig({
      organizer_last_run_at: now,
    } as any);
    return { ok: true, cc_task_id, executor };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export interface ExplorerPauseDecision {
  pause: boolean;
  reason?: string;
  stats?: Record<string, unknown>;
}

// Check whether Explorer should pause RIGHT NOW.
// Called from auto-resume.ts BEFORE dispatching an Explorer run.
export function computeExplorerPauseDecision(): ExplorerPauseDecision {
  const cfg = storage.getCronConfig() as any;
  if (!cfg.explorer_dynamic_pause_enabled) return { pause: false };

  // Check 1: hard cap on open issues (use cached draft_tasks count as proxy)
  const cap: number = cfg.explorer_max_open_issues ?? 1000;
  const openCount: number = storage.countDraftTasks({ status: "proposed" })
    + storage.countDraftTasks({ status: "queued" });
  if (openCount >= cap) {
    return {
      pause: true,
      reason: `open task count ${openCount} >= cap ${cap}`,
      stats: { openCount, cap },
    };
  }

  // Check 2: novelty-floor heuristic on last 2 completed Explorer runs
  const floor: number = cfg.explorer_novelty_floor ?? 2;
  const recent = storage.listRuns(10).filter((r) => r.status === "completed").slice(0, 2);
  if (recent.length === 2) {
    const netNew = recent.reduce((sum, r) => sum + (r.draft_tasks_count ?? 0) + (r.findings_count ?? 0), 0);
    if (netNew < floor * 2) {
      return {
        pause: true,
        reason: `last 2 runs produced only ${netNew} net-new items (< 2 × ${floor} novelty floor) — dynamic pause`,
        stats: { netNew, floor, threshold: floor * 2 },
      };
    }
  }

  return { pause: false };
}

export function setExplorerPaused(reason: string | null): void {
  storage.updateCronConfig({ explorer_paused_reason: reason } as any);
}

// Check whether enough time has passed since the last Organizer dispatch.
export function isOrganizerDue(intervalMinutes: number): boolean {
  const cfg = storage.getCronConfig() as any;
  const lastRunAt: string | null = cfg.organizer_last_run_at ?? null;
  if (!lastRunAt) return true;
  const elapsed = (Date.now() - new Date(lastRunAt).getTime()) / (1000 * 60);
  return elapsed >= intervalMinutes;
}
