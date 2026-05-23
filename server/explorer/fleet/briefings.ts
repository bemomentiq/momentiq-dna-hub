// Fleet briefing builders (split from fleet-routes.ts).

import { buildFluidLoopContext } from "../fluid-loop";

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

The Hub repo (\`bemomentiq/momentiq-dna-hub\`) is the Hub's OWN source — self-improvement work goes there. The momentiq-dna repo hosts the Veo 3.1 + vidgen-engine content engine (TikTok Shop UGC corpus, A/B prompt experiments, Thompson bandit, indistinguishability scoring), and the ScriptSage repos host the creator-facing video generation product. All are valid targets; pick based on highest-EV open issue.
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
