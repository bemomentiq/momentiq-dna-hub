// Fleet dispatch routes for the executor cron and ad-hoc runs.
// Both kinds share the same fleet_runs table, the same dispatch shape, and the
// same fallback discipline (pin-codex / gpt_5_5 primary -> pin-claude / claude_opus_4_7 fallback).

import type { Express } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { isDirectExecutor, spawnDirectAgent, pollDirectRun, reapDeadDirectRuns, DIRECT_TARGETS, type DirectExecutor } from "./direct-dispatch";
import { dispatchWithCascade } from "./cascade-dispatch";
import { buildFluidLoopContext } from "./fluid-loop";
import { dispatchConsolidationToCC } from "./consolidation";

// ============ Briefing builders ============

// Executor cron briefing: scans open `autonomy-hub`-labeled issues in ALL target repos (backend + frontend + hub),
// runs a Phase 0 plan-mode review of EVERY open issue + commits a written plan (status=planning),
// then transitions to execution mode, ships ONE issue end-to-end with PR + auto-merge,
// and writes a `next_pickup` directive so the NEXT run continues where this one left off — like
// one fluid agent run, without context bloat.
//
// Compounding-learning:
//   - Prior 25 executor summaries injected (older ones auto-compacted to [compacted] stubs)
//   - `next_pickup` from the most recent completed run is the explicit handoff
//   - Hub ledger (top 20) injected for cross-cutting patterns
export function buildExecutorBriefing(opts: {
  run_id: number;
  repos: string[];
  hub_status_url: string;
  ingest_url: string;
  cc_api_url: string;
  cc_api_key: string;
  prior_summaries?: { id: number; started_at: string; summary: string; plan_markdown?: string | null; next_pickup?: string | null; gh_pr_url?: string | null; status: string }[];
  ledger?: { pattern: string; heat: number; seen_count: number }[];
  latest_next_pickup?: string | null;
  open_issue_count?: number;
}): string {
  const { run_id, repos, hub_status_url, prior_summaries = [], ledger = [], latest_next_pickup, open_issue_count } = opts;

  const { pickupSection, priorSection, ledgerSection } = buildFluidLoopContext({
    kind: "executor",
    runId: run_id,
    priorRuns: prior_summaries.map((p) => ({
      id: p.id,
      started_at: p.started_at,
      summary: p.summary,
      next_pickup: p.next_pickup,
      gh_pr_url: p.gh_pr_url,
      status: p.status,
    })),
    ledger,
    latestPickup: latest_next_pickup,
    openIssueCount: open_issue_count,
  });

  const openCountNote = typeof open_issue_count === "number" ? ` (hint: roughly ${open_issue_count} open autonomy-hub-labeled issues outstanding)` : "";
  return `## Goal
Continue the fluid executor loop. This run (#${run_id}) is NOT a standalone task — it is the next link in an autonomous chain that will keep running until every open \`autonomy-hub\`-labeled issue across all target repos is shipped or explicitly marked blocked/impossible${openCountNote}.

Steps:
1. Phase 0: plan-mode review of ALL open \`autonomy-hub\`-labeled issues across ${repos.length} target repos
2. Phase 0 also adds test coverage proposals + debugs pre-existing issues found during review
3. Commit the plan to the Hub run record (#${run_id}) as \`plan_markdown\` with status=planning
4. Transition to execution mode, ship ONE issue end-to-end: implement, PR, rebase auto-merge, babysit CI to merge
5. At the END, write a concise \`next_pickup\` directive so the NEXT run continues where you left off without re-planning from scratch

## Context
You are a Mac Mini fleet lane (codex pin = gpt_5_5, claude pin = claude_opus_4_7 thinking). The Autonomy Hub Explorer (a sibling cron) files master/child issues into the target repos:
${repos.map((r) => `- https://github.com/${r}`).join("\n")}

The Hub repo (\`bemomentiq/autonomy-hub\`) is the Hub's OWN source — self-improvement work goes there. The SID backend + frontend repos host autonomy work for the Shop Insights Dashboard. All are valid targets; pick based on highest-EV open issue.
${pickupSection}
### Compounding learning — recent executor runs (last 25, oldest auto-compacted)
${priorSection}

### Compounding learning — Hub learning ledger (heat-sorted top 20)
${ledgerSection}

Use the pickup directive + prior summaries + ledger to: (a) pick up exactly where the prior run left off, (b) avoid re-picking issues other runs already shipped, (c) skip patterns that previously failed CI, (d) prefer the issue-shape that has historically merged cleanest.

Hub run record: GET ${hub_status_url}/api/fleet/runs/${run_id}
Ingest progress: PATCH ${hub_status_url}/api/fleet/runs/${run_id} with {status, summary, gh_pr_url, gh_pr_state, cc_task_status, plan_markdown} as you go.

## Files
This is a real coding task. Clone the target repo, work in a feature branch, push, open PR.
- Branch naming: \`feat/ah-exec-${run_id}-<short-slug>\`
- Issue body has the full 8-H2 spec (Goal/Context/Files/Implementation/Acceptance/Out-of-scope/Commit + PR/Notes); follow it.

## Implementation
Phase 0 — PLAN MODE (review EVERY open issue, no code yet, ≤8 min):
0a. \`gh issue list --state open --label autonomy-hub --limit 100 -R <repo>\` for EACH of ${repos.length} target repos
0b. Also scan for PRE-EXISTING issues that need debugging: \`gh issue list --state open --limit 30 -R <repo>\` (no label filter) — if anything is clearly a broken behavior, fold it into your plan
0c. Build a single triage table with: number, repo, title, labels (priority/area/parent), open PR yes/no, est. effort (S/M/L), risk (low/med/high), test_coverage_gap (y/n), ev_score
0d. Filter OUT: \`tracker\` labeled, already-has-open-PR, blocked-by-untouched-parent, items explicitly labeled \`blocked\` or \`impossible\`
0e. Score remaining: sort by ev_score desc (ev_score = priority_weight × area_money_factor × P(merge_clean) / effort_hrs, fetched from /api/draft-tasks), then by priority weight (p0=4 / p1=3 / p2=2 / p3=1) as tiebreaker. Apply area-bonus (money_path=3, live=2.5, training=2, eval=1.5) + ledger-affinity + test-coverage-gap-bonus (if adding tests here would unblock CI elsewhere) when computing ev_score manually for GitHub issues not yet in draft-tasks.
0f. WRITE the plan as markdown — sections: "Open issues snapshot", "Triage table", "Test-coverage gaps identified", "Pre-existing bugs surfaced", "Recommended top-5 (in order)", "Run #${run_id} pick = #N", "Why this pick", "Risks + rollback", "Expected next_pickup after this run". Aim for 100-250 lines.
0g. PATCH the Hub run record once: \`{ status: "planning", summary: "Plan committed: picking #N - <title>", plan_markdown: "<the markdown>", gh_issue_numbers_json: "[N]" }\`. After this PATCH succeeds, the plan is "committed" and you transition to execution mode.

Phase 1 — TRANSITION TO EXECUTION (≤2 min):
1. Re-read the Phase-0 pick. Open the chosen issue body in full.
2. Confirm files-to-touch list, identify dependencies (does this need a migration? new package? schema change?).
3. PATCH Hub: \`{ status: "running", summary: "Executing #N" }\`.

Phase 2 — EXECUTE (the actual coding work):
4. \`git clone\` the repo (or reuse existing clone in \`$HOME/hub-runs/run-${run_id}/\`)
5. \`git checkout -b feat/ah-exec-${run_id}-<slug>\`
6. Make the changes per the issue's Implementation section
7. \`npx tsc --noEmit\` clean (if backend repo)
8. \`npx vitest run\` clean (if test files exist)
9. \`git add . && git commit -m "feat: <issue-title> (closes #<N>)"\`
10. \`git push origin feat/ah-exec-${run_id}-<slug>\`

Phase 3 — OPEN PR + AUTO-MERGE:
11. \`gh pr create --title "<title>" --body "Closes #<N>\\n\\nAuto-filed by Autonomy Hub executor run #${run_id}.\\n\\n## Plan\\n<paste the Phase-0 plan>" --label autonomy-hub\`
12. \`gh pr merge --rebase --auto\` — rebase strategy ONLY (never squash, never merge-commit, never --force)
13. PATCH Hub: gh_pr_url=<url>, gh_pr_state="open"

Phase 4 — BABYSIT CI:
14. Loop with 60s sleep, max 25 min total:
    - \`gh pr checks <pr-num>\` — if any failing, drop to step 15; if all green and merged, exit success
    - \`gh pr view <pr-num> --json mergeable,mergeStateStatus,state\`
    - if state=MERGED, PATCH Hub: status=completed, gh_pr_state="merged", finished_at=now, summary="<final>", exit
15. On CI failure:
    - \`gh run view <run-id> --log-failed\`
    - Diagnose (lint? test? build? type?)
    - Fix locally; \`git commit --amend --no-edit && git push --force-with-lease\`
    - Loop back to 14
    - **Hard limit: 3 amend cycles**, then PATCH Hub \`{ status: "failed", error: "CI failed after 3 amend cycles" }\` and exit failure

Phase 5 — WRITE \`next_pickup\` DIRECTIVE (mandatory, <= 500 chars):
16. At the end of the run (success OR failure), PATCH Hub ONE MORE TIME with a \`next_pickup\` field that the NEXT run will consume as its explicit handoff:
    - If you successfully merged: \`{ next_pickup: "Next issue to pick: #M (title) in <repo>. Top-3 plan ranking had #M second after #N; same area so context carries. Avoid pattern X from ledger. Check CI state of PR #Q before starting." }\`
    - If you hit a blocker: \`{ next_pickup: "Issue #N is blocked by <reason>. Mark with blocked label and skip. Next-up per plan: #M. If #M also blocks, fall back to #O (different area)." }\`
    - If you ran out of time: \`{ next_pickup: "Was mid-execution on #N. Branch feat/ah-exec-${run_id}-<slug> pushed but PR not yet opened / CI amend cycle Y / etc. Resume from that branch if it's < 1hr old." }\`
    - If there are NO more eligible open issues: \`{ next_pickup: "QUEUE_EMPTY — no eligible open autonomy-hub issues across all ${repos.length} repos. Next run should verify via gh issue list and then trigger the Explorer cron to propose fresh work." }\`

## Acceptance
- Phase-0 plan markdown committed to the Hub run record BEFORE any \`git\` command runs
- One PR opened, rebase auto-merge enabled, all CI green, PR merged via auto-merge (unless queue was empty or hit a blocker)
- Issue closed via "Closes #N"
- Hub run record at status=completed with plan_markdown + gh_pr_url + gh_pr_state="merged" + next_pickup populated
- \`next_pickup\` is ALWAYS populated on exit (success or failure) so the chain stays continuous

## Out-of-scope
- Do NOT touch other open issues in the same run (one issue per run)
- Do NOT use \`gh pr merge --squash\` or \`--merge\` (rebase only)
- Do NOT skip Phase 0 — even if the queue is obviously a single issue, write a 1-page plan and PATCH it
- Do NOT amend force-push more than 3 times

## Commit + PR
- Branch: \`feat/ah-exec-${run_id}-<slug>\`
- Single PR per run, references parent issue with "Closes #N"
- PR body MUST contain the Phase-0 plan inline + link to Hub run #${run_id}: ${hub_status_url}/#/fleet/runs

## Notes
- You have \`--dangerously-bypass-permissions\` for Phases 2-4 since the lane is sandboxed in a fresh repo clone. Phase 0 needs no bypass — it is read-only \`gh\` calls + a single Hub PATCH.
- If Phase 0 finds zero eligible issues, PATCH Hub: \`{ status: "completed", summary: "No eligible issues; queue empty", plan_markdown: "<the empty-queue rationale>", next_pickup: "QUEUE_EMPTY — ..." }\`, exit success.
- Use \`gh pr merge --rebase --auto\` exactly once; do not toggle it.
- The compounding-learning sections at top of this briefing are for YOU — they are not status to ack; they are how you get smarter run-over-run.
- The auto-resumer polls every 30s and dispatches the next executor run as soon as this one completes, as long as the queue is not empty. Your \`next_pickup\` is the continuity thread. Keep it tight (< 500 chars) but substantive.
- IMPORTANT: add testing coverage during execution whenever the touched area has gaps. A PR that ships a feature AND adds tests is always higher EV than one that only ships.
`;
}

// ============ Epic-mode Executor Briefing ============
// Like buildExecutorBriefing but plans + ships an entire EPIC (3-7 PRs) in one run.
// Each child issue gets its own PR; the parent epic issue is kept updated.
export function buildEpicExecutorBriefing(opts: {
  run_id: number;
  repos: string[];
  hub_status_url: string;
  ingest_url: string;
  cc_api_url: string;
  cc_api_key: string;
  prior_summaries?: { id: number; started_at: string; summary: string; next_pickup?: string | null; gh_pr_url?: string | null; status: string }[];
  ledger?: { pattern: string; heat: number; seen_count: number }[];
  latest_next_pickup?: string | null;
}): string {
  const { run_id, repos, hub_status_url, prior_summaries = [], ledger = [], latest_next_pickup } = opts;

  const { pickupSection, priorSection, ledgerSection } = buildFluidLoopContext({
    kind: "executor",
    runId: run_id,
    priorRuns: prior_summaries.map((p) => ({
      id: p.id,
      started_at: p.started_at,
      summary: p.summary,
      next_pickup: p.next_pickup,
      gh_pr_url: p.gh_pr_url,
      status: p.status,
    })),
    ledger,
    latestPickup: latest_next_pickup,
  });

  return `## Goal (Epic-mode Executor, run #${run_id})
Plan and ship ONE EPIC end-to-end: discover the highest-priority open epic issue, list all its child issues (3-7), and sequentially merge each as its own PR. Keep the epic issue updated with merged-child checkboxes. Hard time limit: 35 min.

## Context
Target repos:
${repos.map((r) => `- https://github.com/${r}`).join("\n")}

Hub run record: GET ${hub_status_url}/api/fleet/runs/${run_id}
${pickupSection}
### Prior runs (last 10)
${priorSection}

### Hub ledger (heat-sorted top 20)
${ledgerSection}

## Implementation

### Phase 0 — Pick epic (≤3 min)
\`\`\`
gh issue list --repo <repo> --label epic --state open --limit 20 --json number,title,body,labels
\`\`\`
If no issues have the \`epic\` label, look for issues whose body contains \`[ ] #M\` checkbox patterns.
Pick the highest-priority epic (p0 > p1 > p2; oldest wins ties).
List all child issues: parse checkbox lines + fetch each child with \`gh issue view <N>\`.
PATCH Hub run with \`{ status: "planning", plan_markdown: "<epic title + list of children with effort estimate>" }\`.

### Phase 1 — Plan children (≤5 min)
For each child issue, determine: dependency order, shared branch prefix, test requirements.
Write execution plan to Hub: \`{ plan_markdown: "<full plan>" }\`.

### Phase 2-N — Ship each child (≤5 min each, max 7)
For child issue #M:
1. \`git checkout -b feat/dna-epic-${run_id}-cN-<slug> origin/main\`
2. Implement the change (minimal, scoped to what the issue says)
3. \`npx tsc --noEmit\` clean
4. Commit: \`feat(scope): <description> (epic #P child #M)\`
5. Push + \`gh pr create --title "..." --body "Closes #M\nPart of epic #P"\`
6. \`gh pr merge <num> --rebase --auto\`
7. Wait for merge (poll \`gh pr view <num> --json state -q .state\` every 30s, max 3min)
8. Update epic issue: replace \`- [ ] #M\` with \`- [x] #M\`
9. PATCH Hub run with progress update

### Final — PATCH Hub
PATCH ${hub_status_url}/api/fleet/runs/${run_id} with:
\`{ status: "completed", summary: "Epic #P: shipped N/M children. PRs: <list>", next_pickup: "<next epic or remaining children>" }\`

## Acceptance
- All child PRs merged (or escalated with clear blocker reason)
- Epic issue updated with [x] checkboxes for merged children
- Hub run PATCHED to status=completed with summary

## Out-of-scope
- Starting a second epic in the same run
- Amending PRs more than 3 times

## Notes
- Hard limit: 35 min total (vs 25 min for single-issue executor)
- If you run out of time mid-epic, write next_pickup with the remaining child list
- Skip a child if it is blocked by an unmerged earlier child; note in next_pickup
- Use \`gh pr merge --rebase --auto\` — never squash or merge commit
`;
}

// ============ Codebase Audit Briefing ============
// Instructs the audit lane to:
//   1. Fetch merged PRs from each repo (last 24h by default)
//   2. Read diffs and distill 3-5 architectural patterns
//   3. PUT ledger_patterns to /api/explorer/runs/:id/ingest
//   4. File 1-3 refactor draft_tasks
export function buildCodebaseAuditBriefing(opts: {
  run_id: number;
  repos: string[];
  hub_status_url: string;
  ledger?: { pattern: string; heat: number; seen_count: number }[];
}): string {
  const { run_id, repos, hub_status_url, ledger = [] } = opts;
  const ingestUrl = `${hub_status_url}/api/explorer/runs/${run_id}/ingest`;
  const fleetPatchUrl = `${hub_status_url}/api/fleet/runs/${run_id}`;

  const ledgerSection = ledger.length
    ? ledger
        .map((l, i) => `${i + 1}. [heat=${l.heat.toFixed(2)}, seen=${l.seen_count}] ${l.pattern}`)
        .join("\n")
    : "_(empty — you are the first audit run)_";

  return `## Goal
Perform an autonomous codebase audit across ${repos.length} target repositories. Read recently-merged PRs, distill architectural learnings into the Hub learning ledger, and file refactor draft_tasks for the highest-value improvements identified.

This run is audit #${run_id}. Results are PUT back to the Autonomy Hub at the ingest URL below.

## Context
You are the Codebase Audit Agent — the 4th autonomous role in the Autonomy Hub fleet. Your mission:
- Spot recurring architectural patterns, anti-patterns, and refactor opportunities
- Distill them into short (≤160 char) ledger patterns for future runs to learn from
- File concrete refactor draft_tasks (1-3) so the Executor lane can ship improvements

Target repos:
${repos.map((r) => `- https://github.com/${r}`).join("\n")}

Hub run record: GET ${hub_status_url}/api/fleet/runs/${run_id}
Ingest endpoint: PUT ${ingestUrl}

### Existing ledger (heat-sorted top 20)
${ledgerSection}

Do NOT re-file patterns already on the ledger above (avoid near-duplicates); build on or supersede them.

## Implementation

### Phase 1 — Gather merged PRs (≤5 min)
For EACH target repo, run:
\`\`\`
gh pr list --merged --search "merged:>=24h ago" -R <repo> --limit 30 --json number,title,url,mergedAt,files,additions,deletions,body
\`\`\`
If the search flag does not return results (some GH CLIs require ISO date), fall back to:
\`\`\`
gh pr list --state merged --limit 20 -R <repo> --json number,title,url,mergedAt,files,additions,deletions,body
\`\`\`
For each PR returned, read the diff (\`gh pr diff <number> -R <repo>\`) for PRs with ≤500 changed lines. For larger PRs, read the \`files\` list and spot-read 2-3 key files using \`gh api repos/<repo>/pulls/<number>/files\`.

### Phase 2 — Distill architectural patterns (≤5 min)
For each repo's merged PRs, identify:
- Recurring code shapes (e.g. new endpoint always needs a storage method + zod schema)
- Missing abstractions (e.g. repeated inline SQL that should be a helper)
- Drift risks (e.g. shared schema changed but no migration added)
- Test-coverage gaps (e.g. new route added, no test file touched)
- Performance anti-patterns (e.g. N+1 queries, missing indexes)

Distill 3-5 of the highest-signal patterns into the \`ledger_patterns\` array.
Each pattern: \`pattern\` ≤160 chars + \`context\` ≤800 chars explaining when to apply it.

### Phase 3 — File refactor draft_tasks (1-3)
For each architectural improvement worth automating, create a draft_task with:
- \`title\`: \`[AUDIT-${run_id}-N] <short description>\` (≤140 chars)
- \`description\`: what to refactor and why, with file/PR evidence
- \`repo_url\`: target repo
- \`priority\`: p1 or p2 (audits rarely produce p0)
- \`effort_estimate\`: e.g. "2h", "30 min"
- \`agent_briefing\`: 8-H2 markdown body (Goal / Context / Files / Implementation / Acceptance / Out-of-scope / Commit+PR / Notes)

Limit draft_tasks to 1-3 high-confidence refactors. Prefer smaller, self-contained changes that are easy to ship.

### Phase 4 — PUT results to Hub
Compose STRICT JSON matching this schema:
\`\`\`json
{
  "summary": "<≤2000 chars: repos audited, PRs reviewed, key findings>",
  "next_gameplan": "<≤1500 chars: what the next audit should focus on>",
  "findings": [],
  "ledger_patterns": [
    { "pattern": "<≤160 chars>", "context": "<≤800 chars>" }
  ],
  "draft_tasks": [
    { "title": "...", "description": "...", "project_slug": "momentiq-dna", "repo_url": "https://github.com/<org>/<repo>", "priority": "p1", "effort_estimate": "2h", "executor": "unassigned", "agent_briefing": "..." }
  ],
  "tokens_total": 0
}
\`\`\`

PUT to: ${ingestUrl}
Header: \`Content-Type: application/json\`
Expected response: \`{"ok":true,"counts":{...}}\`
On 400: fix shape and retry once. On 5xx: note the error and exit.

### Phase 5 — PATCH fleet run record
PATCH ${fleetPatchUrl} with:
\`{ "status": "completed", "summary": "<brief>", "finished_at": "<ISO>" }\`

If any phase fails unrecoverably:
PATCH ${fleetPatchUrl} with:
\`{ "status": "failed", "error": "<reason>", "finished_at": "<ISO>" }\`

## Acceptance
- Merged PRs read from all ${repos.length} repos
- PUT to ingest returns HTTP 200
- \`ledger_patterns\` array: 3-5 entries
- \`draft_tasks\` array: 1-3 entries
- Fleet run record PATCHED to status=completed
- Total wall-clock time ≤15 min

## Out-of-scope
- Implementing any refactors (that is the Executor's job)
- Opening PRs
- Reading files that were NOT touched by a merged PR in the audit window

## Commit + PR
No PR needed — this is a read-only audit task. Mark completed via PATCH to the fleet run URL above.

## Notes
- You have read-only GitHub access via \`gh\` CLI; no code changes in any repo
- Prioritize signal over volume: 3 sharp ledger entries beat 10 vague ones
- If a repo has no merged PRs in 24h, log that fact in \`summary\` and skip to the next repo
- The \`findings\` field can be empty \`[]\` — this audit writes to \`ledger_patterns\` and \`draft_tasks\`
`;
}

// Ad-hoc briefing: user supplied a custom prompt; we wrap it in the standard 8-H2 with full repo context injected.
export function buildAdHocBriefing(opts: {
  run_id: number;
  user_prompt: string;
  repo_url: string;
  hub_status_url: string;
  recent_prs?: { number: number; title: string }[];
  open_issues?: { number: number; title: string }[];
  loaded_skills: string[];
}): string {
  const { run_id, user_prompt, repo_url, hub_status_url, recent_prs = [], open_issues = [], loaded_skills } = opts;
  const repoName = repo_url.replace("https://github.com/", "");
  return `## Goal
${user_prompt.split("\n")[0]}

## Context
This is an **ad-hoc fleet run** dispatched from the Autonomy Hub by the user (Alex Elsea). The user's full prompt is below in the "User prompt" section. Treat it as the source of truth for what to build/fix.

Hub run record: ${hub_status_url}/#/fleet/runs (run #${run_id})
Repo: ${repo_url}
Loaded skills (already in your context): ${loaded_skills.map((s) => `\`${s}\``).join(", ")}

### Recent merged PRs (last 10)
${recent_prs.slice(0, 10).map((p) => `- #${p.number}: ${p.title}`).join("\n") || "_(none)_"}

### Open autonomy-hub issues (snapshot)
${open_issues.slice(0, 15).map((i) => `- #${i.number}: ${i.title}`).join("\n") || "_(none)_"}

### User prompt (verbatim — this is what you're being asked to do)
\`\`\`
${user_prompt}
\`\`\`

## Files
Determine which files to touch by reading the prompt + the repo. Default to:
- Backend changes → \`${repoName.includes("frontend") ? "bemomentiq/momentiq-dna" : repoName}\`
- Frontend changes → \`${repoName.includes("frontend") ? repoName : "bemomentiq/momentiq-dna"}\`

## Implementation
1. Clone \`${repoName}\` and checkout a feature branch: \`feat/ah-adhoc-${run_id}-<slug>\`
2. Read the user prompt carefully; if anything is ambiguous, make the most reasonable interpretation and document it in the PR body.
3. Make the changes
4. \`npx tsc --noEmit\` clean
5. \`npx vitest run\` clean (if tests touched)
6. Commit with descriptive message; push.

## Acceptance
- PR opened with rebase auto-merge enabled
- All CI green at merge time
- Hub run record patched with gh_pr_url + status="completed"
- Brief summary in commit + PR body explaining what was done and why

## Out-of-scope
- Anything not requested in the user prompt (no surprise refactors)

## Commit + PR
- Branch: \`feat/ah-adhoc-${run_id}-<slug>\`
- PR title prefix: \`[AH-ADHOC-${run_id}]\`
- Body must include: link to Hub run #${run_id}, summary of changes, any assumptions made
- Enable: \`gh pr merge --rebase --auto\`
- Babysit CI for up to 25 min; max 3 amend cycles on failures

## Notes
- You have \`--dangerously-bypass-permissions\` after the plan phase
- This run was dispatched at p0 to jump the queue ahead of regular work
- PATCH the Hub run record (${hub_status_url}/api/fleet/runs/${run_id}) at every phase boundary
`;
}

// ============ Dispatch helper ============

async function ccDispatch(opts: {
  cc_api_url: string;
  cc_api_key: string;
  title: string;
  description: string;
  projectSlug: string;
  repoUrl: string;
  priority: string;
  executor: string;
  agentBriefing: string;
  relevantSkills: string[];
  taskType?: string;
}): Promise<{ ok: boolean; cc_task_id?: number; error?: string }> {
  const ccTask = {
    title: opts.title,
    description: opts.description,
    projectSlug: opts.projectSlug,
    repoUrl: opts.repoUrl,
    priority: opts.priority,
    taskType: opts.taskType || "dev_task",
    automatable: true,
    relevantSkills: opts.relevantSkills,
    effortEstimate: "30 min",
    executor: opts.executor,
    status: "planned",
    agentBriefing: opts.agentBriefing,
  };
  try {
    const r = await fetch(`${opts.cc_api_url}/api/tasks/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": opts.cc_api_key },
      body: JSON.stringify([ccTask]),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status}: ${text.slice(0, 300)}` };
    const parsed: any = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const ccTasks: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? parsed?.created ?? []);
    const ccTaskId = ccTasks[0]?.id ?? ccTasks[0]?.taskId ?? null;
    return { ok: true, cc_task_id: ccTaskId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ============ Helper: fetch GitHub context for ad-hoc briefing ============
async function fetchGhContext(repo: string, token: string | null): Promise<{ recent_prs: { number: number; title: string }[]; open_issues: { number: number; title: string }[] }> {
  if (!token) return { recent_prs: [], open_issues: [] };
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const [prsR, issuesR] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&sort=updated&direction=desc`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=autonomy-hub&per_page=15`, { headers }),
    ]);
    const prs = prsR.ok ? (await prsR.json()) as any[] : [];
    const issues = issuesR.ok ? (await issuesR.json()) as any[] : [];
    return {
      recent_prs: prs.filter((p) => p.merged_at).slice(0, 10).map((p) => ({ number: p.number, title: p.title })),
      open_issues: issues.filter((i) => !i.pull_request).slice(0, 15).map((i) => ({ number: i.number, title: i.title })),
    };
  } catch {
    return { recent_prs: [], open_issues: [] };
  }
}

// ============ Routes ============

export function registerFleetRoutes(app: Express) {
  const prodHost = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.up.railway.app/port/5000" : "http://localhost:5000";
  const hubBase = process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.up.railway.app/port/5000" : "http://localhost:5000";

  // List fleet runs (executor + ad-hoc)
  app.get("/api/fleet/runs", (req, res) => {
    const kind = (req.query.kind as string) || undefined;
    const status = (req.query.status as string) || undefined;
    res.json(storage.listFleetRuns({ kind, status, limit: 80 }));
  });

  // Get one fleet run
  app.get("/api/fleet/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    res.json(run);
  });

  // PATCH a fleet run (lanes call this to report progress)
  app.patch("/api/fleet/runs/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({
      status: z.enum(["queued", "running", "planning", "completed", "failed", "cancelled"]).optional(),
      summary: z.string().optional(),
      error: z.string().optional().nullable(),
      cc_task_status: z.string().optional().nullable(),
      gh_pr_url: z.string().optional().nullable(),
      gh_pr_state: z.string().optional().nullable(),
      gh_issue_numbers_json: z.string().optional(),
      plan_markdown: z.string().optional().nullable(),
      next_pickup: z.string().optional().nullable(),
      finished_at: z.string().optional().nullable(),
    }).parse(req.body);
    const final: any = { ...updates };
    // Snapshot old state before mutating
    const prevRun = storage.getFleetRun(id);
    if (final.status === "completed" || final.status === "failed" || final.status === "cancelled") {
      final.finished_at = final.finished_at || new Date().toISOString();
      if (prevRun) final.duration_ms = new Date(final.finished_at).getTime() - new Date(prevRun.started_at).getTime();
    }
    const u = storage.updateFleetRun(id, final);
    if (!u) return void res.status(404).json({ error: "not found" });

    // Fire-and-forget PR-outcome attribution
    const prodHost = process.env.PROD_HOST || "http://localhost:5000";
    const newPrState = final.gh_pr_state;
    const prevPrState = prevRun?.gh_pr_state;
    if (newPrState === "merged" && prevPrState !== "merged") {
      // Merged — positive heat bump
      fetch(`${prodHost}/api/feedback/pr-merged`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          run_id: id,
          ci_cycles: 0,
          reviewer_comments: 0,
          outcome: "merged",
        }),
      }).catch(() => { /* fire-and-forget */ });
    } else if (
      (final.status === "failed" || newPrState === "closed") &&
      prevRun?.status !== "failed" &&
      prevRun?.status !== "cancelled"
    ) {
      // Count amend cycles from the error field or a heuristic; trigger penalty after 3+
      const ciCycles = (final.ci_cycles as number) ?? 0;
      if (ciCycles >= 3) {
        fetch(`${prodHost}/api/feedback/pr-merged`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            run_id: id,
            ci_cycles: ciCycles,
            reviewer_comments: 0,
            outcome: "failed",
          }),
        }).catch(() => { /* fire-and-forget */ });
      }
    }

    res.json(u);
  });

  // Cancel a fleet run
  app.post("/api/fleet/runs/:id/cancel", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (run.status === "completed" || run.status === "failed") return void res.status(409).json({ error: `already ${run.status}` });
    const u = storage.updateFleetRun(id, { status: "cancelled", finished_at: new Date().toISOString() });
    res.json(u);
  });

  // ==================== REPLAY ====================
  // Re-dispatch a failed or cancelled fleet run with the same agent_briefing + kind + executor.
  // Creates a new fleet_runs row linked to the original via parent_run_id.
  app.post("/api/fleet/runs/:id/replay", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return void res.status(400).json({ error: "invalid id" });
    const original = storage.getFleetRun(id);
    if (!original) return void res.status(404).json({ error: "not found" });
    if (original.status !== "failed" && original.status !== "cancelled") {
      return void res.status(409).json({ error: `cannot replay a run with status '${original.status}' — only failed or cancelled runs can be replayed` });
    }

    const cfg = storage.getCronConfig() as any;
    const executor = original.executor || "pin-codex";
    const direct = isDirectExecutor(executor as DirectExecutor);
    const directTgt = direct ? DIRECT_TARGETS[executor as DirectExecutor] : null;

    // 1. Create new run row, copying key fields from original and linking parent_run_id.
    const newRun = storage.createFleetRun({
      kind: original.kind,
      started_at: new Date().toISOString(),
      status: "queued",
      trigger: "replay",
      executor,
      fallback_executor: original.fallback_executor,
      model: directTgt?.model ?? original.model,
      priority: original.priority,
      repo_url: original.repo_url,
      gh_issue_numbers_json: original.gh_issue_numbers_json,
      user_prompt: original.user_prompt,
      agent_briefing: original.agent_briefing,
      parent_run_id: original.id,
    } as any);

    // 2. Dispatch — direct path or CC queue path, matching the original run's executor.
    if (direct) {
      const spawn = await spawnDirectAgent({
        cc_api_url: cfg.cc_api_url,
        cc_api_key: cfg.cc_api_key,
        executor: executor as DirectExecutor,
        run_id: newRun.id,
        agent_briefing: original.agent_briefing,
        hub_status_url: hubBase,
        repo_url: original.repo_url,
      });
      if (!spawn.ok) {
        storage.updateFleetRun(newRun.id, { status: "failed", error: spawn.error ?? "spawn failed", finished_at: new Date().toISOString() });
        return void res.status(502).json({ error: "direct spawn failed", detail: spawn.error });
      }
      storage.updateFleetRun(newRun.id, {
        status: "running",
        direct_marker: spawn.pid ? `agentId=${spawn.agentId};pid=${spawn.pid};workdir=${spawn.workdir}` : null,
      } as any);
      return void res.json({ ok: true, run: newRun, executor, direct: true, parent_run_id: original.id });
    }

    // CC queue path (executor_cron or ad_hoc non-direct)
    const replayTitle = original.kind === "ad_hoc"
      ? `[AH-REPLAY-R${newRun.id}] (replay of #${original.id}) ${(original.user_prompt ?? original.agent_briefing).split("\n")[0].slice(0, 70)}`
      : `[AH-REPLAY-R${newRun.id}] Executor replay (orig #${original.id})`;

    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: replayTitle,
      description: `Replay of fleet run #${original.id} (${original.kind}, ${original.status}). Same briefing re-dispatched.`,
      projectSlug: cfg.default_cc_project_slug || "momentiq-dna",
      repoUrl: original.repo_url,
      priority: original.priority,
      executor,
      agentBriefing: original.agent_briefing,
      relevantSkills: ["codex-fleet", "momentiq-shop-insights-dashboard-v2"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(newRun.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "CC dispatch failed", detail: dispatch.error });
    }

    storage.updateFleetRun(newRun.id, { status: "running", cc_task_id: dispatch.cc_task_id ?? null });
    res.json({ ok: true, run: newRun, cc_task_id: dispatch.cc_task_id, executor, parent_run_id: original.id });
  });

  // ==================== EXECUTOR CRON DISPATCH ====================
  // Called by the executor cron each fire. Creates a fleet run + dispatches to fleet.
  app.post("/api/executor/dispatch", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "executor_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const projectSlug = (req.body?.project_slug as string) || "momentiq-dna";
    // Default repo: backend (most issues land there)
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    // 1. Create the run row
    const run = storage.createFleetRun({
      kind: "executor_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-codex" ? "gpt_5_5" : "claude_opus_4_7",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      agent_briefing: "",
    });

    // 2. Build the briefing — inject compounding-learning context (prior 25 executor runs + Hub ledger + pickup directive)
    storage.compactStaleFleetSummaries("executor_cron", 25);
    const priorExecRuns = storage.listFleetRuns({ kind: "executor_cron", limit: 40 })
      .filter((r) => r.id !== run.id && (r.status === "completed" || r.status === "failed" || r.summary))
      .slice(0, 25)
      .map((r) => ({
        id: r.id,
        started_at: r.started_at,
        summary: r.summary || "",
        plan_markdown: (r as any).plan_markdown,
        next_pickup: (r as any).next_pickup,
        gh_pr_url: r.gh_pr_url,
        status: r.status,
      }));
    // Latest completed executor run with a real next_pickup is the explicit handoff
    const latestPickup = priorExecRuns.find((r) => r.next_pickup && !r.next_pickup.startsWith("[compacted]"))?.next_pickup ?? null;
    const ledgerForExec = storage.listLedger(20).map((l) => ({
      pattern: l.pattern,
      heat: l.heat,
      seen_count: l.seen_count,
    }));

    const epicMode = Boolean((cfg as any).epic_mode);
    const repos = [cfg.default_gh_repo, cfg.frontend_gh_repo, (cfg as any).hub_gh_repo].filter(Boolean);
    const baseOpts = {
      run_id: run.id,
      repos,
      hub_status_url: hubBase,
      ingest_url: `${prodHost}/api/fleet/runs/${run.id}`,
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      prior_summaries: priorExecRuns,
      ledger: ledgerForExec,
      latest_next_pickup: latestPickup,
    };
    const briefing = epicMode
      ? buildEpicExecutorBriefing(baseOpts)
      : buildExecutorBriefing({ ...baseOpts, open_issue_count: undefined });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    // 3. Dispatch via 4-way cascade (mini-4 primary, mini-5 fallback; codex primary provider).
    // Cron-triggered executor runs go through direct SSH, not CC queue.
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({
      ok: true,
      run_id: run.id,
      pid: dispatch.pid,
      final_target: dispatch.finalTarget,
      cascade_index: dispatch.cascadeIndex,
      model_pin: dispatch.model ?? "gpt_5_5",
      attempts: dispatch.attempts,
      direct_marker: dispatch.directMarker,
    });
  });

  // ==================== EPIC EXECUTOR DISPATCH ====================
  app.post("/api/executor/dispatch-epic", async (req, res) => {
    const cfg = storage.getCronConfig();
    const trigger = (req.body?.trigger as string) || "executor_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    const run = storage.createFleetRun({
      kind: "executor_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-codex" ? "gpt_5_5" : "claude_opus_4_7",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      agent_briefing: "",
    });

    storage.compactStaleFleetSummaries("executor_cron", 25);
    const priorExecRuns = storage.listFleetRuns({ kind: "executor_cron", limit: 20 })
      .filter((r) => r.id !== run.id && (r.status === "completed" || r.status === "failed" || r.summary))
      .slice(0, 10)
      .map((r) => ({ id: r.id, started_at: r.started_at, summary: r.summary || "", next_pickup: (r as any).next_pickup, gh_pr_url: r.gh_pr_url, status: r.status }));
    const latestPickup = priorExecRuns.find((r) => r.next_pickup && !r.next_pickup.startsWith("[compacted]"))?.next_pickup ?? null;
    const ledgerForExec = storage.listLedger(20).map((l) => ({ pattern: l.pattern, heat: l.heat, seen_count: l.seen_count }));

    const briefing = buildEpicExecutorBriefing({
      run_id: run.id,
      repos: [cfg.default_gh_repo, cfg.frontend_gh_repo, (cfg as any).hub_gh_repo].filter(Boolean),
      hub_status_url: hubBase,
      ingest_url: `${prodHost}/api/fleet/runs/${run.id}`,
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      prior_summaries: priorExecRuns,
      ledger: ledgerForExec,
      latest_next_pickup: latestPickup,
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({ ok: true, run_id: run.id, mode: "epic", pid: dispatch.pid, final_target: dispatch.finalTarget, cascade_index: dispatch.cascadeIndex });
  });

  // Executor fallback: re-dispatch SAME run to claude lane
  app.post("/api/executor/dispatch/fallback", async (req, res) => {
    const runId = parseInt((req.query.run_id as string) || (req.body?.run_id as string) || "0", 10);
    if (!runId) return void res.status(400).json({ error: "run_id required" });
    const run = storage.getFleetRun(runId);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (run.status === "completed") return void res.status(409).json({ error: "already completed" });

    const cfg = storage.getCronConfig();
    const fallbackExecutor = (req.body?.executor as string) || run.fallback_executor || "pin-claude";

    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: `[AH-EXEC-R${runId}-FB] Fallback executor: ${fallbackExecutor}`,
      description: `FALLBACK for executor run #${runId}. Primary lane stalled. Re-dispatching to ${fallbackExecutor} (${fallbackExecutor === "pin-claude" ? "claude_opus_4_7 thinking" : "gpt_5_5"}).`,
      projectSlug: "momentiq-dna",
      repoUrl: run.repo_url,
      priority: "p0",
      executor: fallbackExecutor,
      agentBriefing: `## Goal\nFALLBACK dispatch for Autonomy Hub executor run #${runId}. Primary lane (gpt_5_5) did not complete in time.\n\n${run.agent_briefing}`,
      relevantSkills: ["codex-fleet", "momentiq-shop-insights-dashboard-v2", "sid-autonomy-actions-catalog", "sid-pr-guardian"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) return void res.status(502).json({ error: "CC fallback dispatch failed", detail: dispatch.error });
    storage.updateFleetRun(runId, { error: `cc_task_fb:${dispatch.cc_task_id ?? "?"} (was ${run.error ?? "-"})` });
    res.json({ ok: true, run_id: runId, fallback_cc_task_id: dispatch.cc_task_id, executor: fallbackExecutor });
  });

  // ==================== AD-HOC RUN DISPATCH (immediate, p0, concurrent) ====================
  // Two paths:
  //  - executor in {pin-codex, pin-claude, unassigned}  → CC queue (FIFO).
  //  - executor in {pin-codex-direct, pin-claude-direct} → SSH-via-CC into mini-5,
  //    spawn agent inline. Concurrent to whatever CC is doing.
  app.post("/api/run/dispatch", async (req, res) => {
    const body = z.object({
      user_prompt: z.string().min(3).max(8000),
      repo: z.enum(["backend", "frontend", "hub"]).default("backend"),
      executor: z.enum(["pin-codex", "pin-claude", "unassigned", "pin-codex-direct", "pin-claude-direct"]).default("pin-codex"),
      priority: z.enum(["p0", "p1", "p2", "p3"]).default("p0"),
    }).parse(req.body);

    const cfg = storage.getCronConfig() as any;
    const repoName = body.repo === "frontend"
      ? cfg.frontend_gh_repo
      : body.repo === "hub"
      ? (cfg as any).hub_gh_repo
      : cfg.default_gh_repo;
    const repoUrl = `https://github.com/${repoName}`;
    const direct = isDirectExecutor(body.executor);
    const directTgt = direct ? DIRECT_TARGETS[body.executor as DirectExecutor] : null;

    // 1. Create the run row
    const run = storage.createFleetRun({
      kind: "ad_hoc",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger: direct ? "user_run_button_direct" : "user_run_button",
      executor: body.executor,
      fallback_executor: body.executor === "pin-codex" ? "pin-claude" : body.executor === "pin-codex-direct" ? "pin-claude-direct" : null,
      model: directTgt?.model ?? (body.executor === "pin-codex" ? "gpt_5_5" : body.executor === "pin-claude" ? "claude_opus_4_7" : "unassigned"),
      priority: body.priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]",
      user_prompt: body.user_prompt,
      agent_briefing: "",
    });

    // 2. Pull GH context (recent PRs + open issues) for richer briefing
    const ghToken = cfg.github_token || process.env.GITHUB_TOKEN || null;
    const ghCtx = await fetchGhContext(repoName, ghToken);

    const briefing = buildAdHocBriefing({
      run_id: run.id,
      user_prompt: body.user_prompt,
      repo_url: repoUrl,
      hub_status_url: hubBase,
      recent_prs: ghCtx.recent_prs,
      open_issues: ghCtx.open_issues,
      loaded_skills: ["codex-fleet", "momentiq-shop-insights-dashboard-v2", "sid-autonomy-actions-catalog"],
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });

    // ---------- DIRECT PATH ----------
    if (direct) {
      const spawn = await spawnDirectAgent({
        cc_api_url: cfg.cc_api_url,
        cc_api_key: cfg.cc_api_key,
        executor: body.executor as DirectExecutor,
        run_id: run.id,
        agent_briefing: briefing,
        hub_status_url: hubBase,
        repo_url: repoUrl,
      });
      if (!spawn.ok) {
        storage.updateFleetRun(run.id, { status: "failed", error: spawn.error ?? "spawn failed", finished_at: new Date().toISOString() });
        return void res.status(502).json({ error: "direct spawn failed", detail: spawn.error });
      }
      // Store direct-dispatch marker in its own column (not in error)
      storage.updateFleetRun(run.id, {
        status: "running",
        direct_marker: spawn.pid ? `agentId=${spawn.agentId};pid=${spawn.pid};workdir=${spawn.workdir}` : null,
      } as any);
      return void res.json({
        ok: true,
        run,
        executor: body.executor,
        model_pin: spawn.model,
        direct: true,
        agentId: spawn.agentId,
        agent: spawn.agent,
        pid: spawn.pid,
        workdir: spawn.workdir,
      });
    }

    // ---------- CC QUEUE PATH ----------
    const dispatch = await ccDispatch({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      title: `[AH-ADHOC-R${run.id}] ${body.user_prompt.split("\n")[0].slice(0, 80)}`,
      description: `Ad-hoc fleet run dispatched from Autonomy Hub. User prompt: ${body.user_prompt.slice(0, 200)}`,
      projectSlug: "momentiq-dna",
      repoUrl,
      priority: body.priority,
      executor: body.executor,
      agentBriefing: briefing,
      relevantSkills: ["codex-fleet", "momentiq-shop-insights-dashboard-v2", "sid-autonomy-actions-catalog"],
      taskType: "dev_task",
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "CC dispatch failed", detail: dispatch.error });
    }

    storage.updateFleetRun(run.id, { status: "running", cc_task_id: dispatch.cc_task_id ?? null });
    res.json({
      ok: true,
      run,
      cc_task_id: dispatch.cc_task_id,
      executor: body.executor,
      model_pin: body.executor === "pin-codex" ? "gpt_5_5" : body.executor === "pin-claude" ? "claude_opus_4_7 (thinking)" : "unassigned",
    });
  });

  // ==================== DIRECT RUN POLL ====================
  // Live tail of stdout/stderr for a direct run. The /run + /fleet UIs poll this
  // every few seconds while a direct run is in 'running' state.
  app.get("/api/fleet/runs/:id/poll", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const run = storage.getFleetRun(id);
    if (!run) return void res.status(404).json({ error: "not found" });
    if (!isDirectExecutor(run.executor)) {
      return void res.json({ ok: true, direct: false, message: "not a direct run; nothing to poll" });
    }
    // Read marker from direct_marker column (preferred) or fall back to legacy error-field marker
    const markerStr = (run as any).direct_marker || (run.error?.startsWith("direct:") ? run.error.replace(/^direct:/, "") : "");
    const marker = markerStr.match(/^agentId=([^;]+);pid=(\d+);workdir=(.+)$/);
    if (!marker) return void res.json({ ok: true, direct: true, message: "no marker; spawn may have failed" });
    const [, agentId, pidStr, workdir] = marker;
    const cfg = storage.getCronConfig();
    const polled = await pollDirectRun({
      cc_api_url: cfg.cc_api_url,
      cc_api_key: cfg.cc_api_key,
      agentId,
      workdir,
      pid: parseInt(pidStr, 10),
    });

    // Auto-mark completed/failed when the agent has exited (don't make the user click reap).
    // Trust the EXIT CODE only — codex emits ERROR-level logs (rate-limit telemetry,
    // refresh attempts) even on successful runs, so stderr-keyword sniffing is unreliable.
    if (polled.ok && polled.exited && (run.status === "running" || run.status === "queued")) {
      const exitCode = polled.exit_signal?.trim();
      const finalStatus = exitCode === "0" ? "completed" : "failed";
      const summaryFromStdout = polled.stdout_tail.trim().split("\n").slice(-3).join(" \u2502 ").slice(0, 500);
      storage.updateFleetRun(id, {
        status: finalStatus,
        finished_at: new Date().toISOString(),
        summary: summaryFromStdout || (finalStatus === "completed" ? "(empty stdout but exit 0)" : ""),
        error: finalStatus === "failed" ? polled.stderr_tail.slice(-500) : null,
      } as any);
    }
    res.json({ direct: true, run_id: id, agentId, workdir, ...polled });
  });

  // ==================== AUDIT CRON DISPATCH ====================
  // Creates a fleet_runs row with kind='audit_cron' and dispatches the Codebase Audit Agent.
  // Can be triggered manually (POST /api/audit/dispatch) or by the auto-resumer every N hours.
  app.post("/api/audit/dispatch", async (req, res) => {
    const cfg = storage.getCronConfig() as any;
    const trigger = (req.body?.trigger as string) || "audit_cron";
    const executor = (req.body?.executor as string) || "pin-codex";
    const fallback = (req.body?.fallback_executor as string) || "pin-claude";
    const priority = (req.body?.priority as string) || "p1";
    const repoUrl = (req.body?.repo_url as string) || `https://github.com/${cfg.default_gh_repo}`;

    // 1. Create the run row (kind='audit_cron')
    const run = storage.createFleetRun({
      kind: "audit_cron",
      started_at: new Date().toISOString(),
      status: "queued",
      trigger,
      executor,
      fallback_executor: fallback,
      model: executor === "pin-claude" ? "claude_opus_4_7" : "gpt_5_5",
      priority,
      repo_url: repoUrl,
      gh_issue_numbers_json: "[]" ,
      agent_briefing: "",
    });

    // 2. Build audit briefing — inject current ledger for dedup context
    const ledgerForAudit = storage.listLedger(20).map((l) => ({
      pattern: l.pattern,
      heat: l.heat,
      seen_count: l.seen_count,
    }));

    const auditRepos = [
      cfg.default_gh_repo,
      cfg.frontend_gh_repo,
      cfg.hub_gh_repo,
    ].filter(Boolean) as string[];

    // The audit agent PUTs results into an explorer run so we need one to ingest into
    const explorerRun = storage.createRun({
      started_at: new Date().toISOString(),
      status: "running",
      trigger: "audit_cron",
      model: cfg.model || "claude_opus_4_7",
    });

    const briefing = buildCodebaseAuditBriefing({
      run_id: explorerRun.id,
      repos: auditRepos,
      hub_status_url: hubBase,
      ledger: ledgerForAudit,
    });
    storage.updateFleetRun(run.id, { agent_briefing: briefing });
    storage.updateRun(explorerRun.id, { summary: `Audit fleet run #${run.id}` } as any);

    // 3. Dispatch via 4-way cascade
    const preferredProvider = executor === "pin-claude" ? "claude" as const : "codex" as const;
    const dispatch = await dispatchWithCascade({
      kind: "executor",
      runId: run.id,
      briefing,
      preferredProvider,
      preferredMini: "mini-4",
      hubStatusUrl: `${prodHost}/api/fleet/runs/${run.id}`,
      ccApiUrl: cfg.cc_api_url,
      ccApiKey: cfg.cc_api_key,
    });

    if (!dispatch.ok) {
      storage.updateFleetRun(run.id, { status: "failed", error: dispatch.error, finished_at: new Date().toISOString() });
      return void res.status(502).json({ error: "cascade dispatch failed", detail: dispatch.error, attempts: dispatch.attempts });
    }

    storage.updateFleetRun(run.id, {
      status: "running",
      ...(dispatch.directMarker ? { direct_marker: dispatch.directMarker } : {}),
    } as any);
    res.json({
      ok: true,
      run_id: run.id,
      explorer_run_id: explorerRun.id,
      pid: dispatch.pid,
      final_target: dispatch.finalTarget,
      cascade_index: dispatch.cascadeIndex,
      model_pin: dispatch.model ?? "gpt_5_5",
      attempts: dispatch.attempts,
      direct_marker: dispatch.directMarker,
    });
  });

  // ==================== REAPER ENDPOINT ====================
  // Marks dead direct runs as failed/completed. Called manually or by an external
  // monitor (we'll expose a button on /fleet for this).
  app.post("/api/fleet/reap-dead-direct-runs", async (_req, res) => {
    const cfg = storage.getCronConfig();
    const out = await reapDeadDirectRuns({ cc_api_url: cfg.cc_api_url, cc_api_key: cfg.cc_api_key });
    res.json(out);
  });

  // ==================== CONSOLIDATION CRON ====================
  // Manual "dispatch now" trigger for the consolidation cron lane.
  // Also serves as the cron config GET/PATCH surface for consolidation settings.
  app.post("/api/consolidation/dispatch-now", async (_req, res) => {
    const result = await dispatchConsolidationToCC();
    res.json(result);
  });

  app.get("/api/consolidation/config", (_req, res) => {
    const cfg = storage.getCronConfig();
    res.json({
      enabled: Boolean(cfg.consolidation_cron_enabled),
      interval_hours: cfg.consolidation_cron_interval_hours,
      briefing_gist: cfg.consolidation_briefing_gist,
      last_run_at: cfg.consolidation_last_run_at ?? null,
      last_cc_task_id: cfg.consolidation_last_cc_task_id ?? null,
    });
  });

  app.patch("/api/consolidation/config", (req, res) => {
    const body = z.object({
      enabled: z.boolean().optional(),
      interval_hours: z.number().int().min(1).max(24).optional(),
      briefing_gist: z.string().url().optional(),
    }).parse(req.body);
    const updates: Parameters<typeof storage.updateCronConfig>[0] = {};
    if (body.enabled !== undefined) updates.consolidation_cron_enabled = body.enabled;
    if (body.interval_hours !== undefined) updates.consolidation_cron_interval_hours = body.interval_hours;
    if (body.briefing_gist !== undefined) updates.consolidation_briefing_gist = body.briefing_gist;
    storage.updateCronConfig(updates);
    const cfg = storage.getCronConfig();
    res.json({
      enabled: Boolean(cfg.consolidation_cron_enabled),
      interval_hours: cfg.consolidation_cron_interval_hours,
      briefing_gist: cfg.consolidation_briefing_gist,
      last_run_at: cfg.consolidation_last_run_at ?? null,
      last_cc_task_id: cfg.consolidation_last_cc_task_id ?? null,
    });
  });
}
