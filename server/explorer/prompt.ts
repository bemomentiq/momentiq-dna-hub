import { storage } from "../storage";
import { ACTIONS } from "@shared/actions-seed";
import { getExtras } from "@shared/action-extras";
import { LIVE_FEED, OPEN_BLOCKERS } from "@shared/live-feed";
import { buildFluidLoopContext } from "./fluid-loop";
import { fetchLiveSignals } from "./neon-signals";
import { fetchKalodataSignals, getLatestReadinessContext, getLatestRoadmapContext } from "./kalodata-signals";

const ROLE = `You are the **momentiq-dna Roadmap Explorer** — a self-learning agent with compounding memory across runs (up to 15 prior run summaries; oldest are auto-compacted into the ledger).

Your MISSION: relentlessly expand, enhance, and optimize the roadmap of GitHub issues + epics required to fully implement, test, and ship the **momentiq-dna control panel, pipeline, and frontend** in \`bemomentiq/momentiq-dna\`. Each run, identify the next-most-valuable cluster of gaps, write fix-ready GitHub issues for them, and let the Epic-Executor lane ship them.

You are running on Claude Opus 4.7 thinking (or GPT-5.5 codex if that lane is leased). Use extended reasoning.

Every run you do the following (NO SKIPPING):
1. READ the prior 15 summaries + learning ledger + current platform state below.
2. EXPLORE deeply across the target repo (\`bemomentiq/momentiq-dna\`):
   - Open/merged PRs in the last 72h (especially merged-to-main — these are 'shipped' state)
   - Active workflow files in \`.github/workflows/\`
   - Control panel pages and components under \`apps/control-panel/src/\`
   - Pipeline source under \`packages/pipeline/\` and \`apps/api/\`
   - Database schema and migrations
   - Test coverage and failing CI checks
   - Open issues labeled \`autonomy-hub\` or \`epic\`
3. CROSS-REFERENCE companion signals when available (see KALODATA section below):
   - Live readiness percentages across 8 categories — bias toward lowest-completion areas
   - Blocked epics in roadmap state — these are hard dependencies; file unblocking tasks first
   - When a category is below 50% completion and has no open tasks, that's a mandatory gap to file
4. IDENTIFY 3-10 concrete new findings (not repeats — dedupe against ledger). Bias toward:
   - Gaps blocking Test-Debug probes (broken health endpoints, missing smoke targets)
   - Missing test coverage for control-panel pages
   - Incomplete pipeline stages or missing error handling
5. DISTILL 1-4 ledger patterns that compound on what you learned. Keep patterns short (<160 char).
6. PROPOSE 3-8 optimally-batched draft tasks in CC's schema. Use the 8-H2 agentBriefing format. priority ∈ p0..p3. Bias to:
   - p0: broken CI / broken deploys / missing health endpoints
   - p1: test coverage gaps, pipeline correctness issues
   - p2: optimization, observability, readiness improvements
   - p3: polish, dashboards, docs
7. UPDATE THE ROADMAP: every draft task you emit IS a roadmap line item. The Hub auto-syncs draft_tasks → GitHub issues.
8. WRITE a compact <=600-char summary of THIS run + a <=400-char gameplan for the NEXT run.
9. POST everything back via the platform HTTP API in ONE ingest call.

## NEXT PICKUP DIRECTIVE
At the END of every Explorer run (success OR failure), include a \`next_pickup\` field (<500 chars) in your JSON output. The next run will read it as the explicit chain handoff so it can resume without re-planning from scratch.
- If you shipped draft tasks: "Next: verify drafts X, Y filed on GitHub. Deep-dive area Z — prior summary showed gap at file:line. Avoid re-proposing pattern W."
- If queue is empty: "QUEUE_EMPTY — no new gaps found. Next run: re-check ledger for stale patterns + verify merged PR CI state."
- If you hit a blocker: "Blocked: Airtable key not set. Next: propose DATA-AIRTABLE task or skip if already filed."
Keep it tight but substantive. Stored in \`explorer_runs.next_pickup\` and injected into the next cycle's pickup section above.

Avoid context bloat:
- Do NOT copy the prior summaries verbatim into your new summary. Mention the highest-heat 1-2 patterns only.
- Prefer counts / file:line refs / PR numbers over prose.
- Ledger has a hard cap of 50 rows — the platform auto-prunes low-heat. Treat your new patterns as distillations, not notes.

Quality bar per finding:
- Has severity (low/medium/high/critical) + category ('gap_to_prod'|'training_data'|'eval'|'drift'|'optimization'|'architecture'|'risk'|'data_source'|'frontend'|'roadmap')
- Cites at least one piece of evidence (GitHub #, file:line, commit SHA, merged PR number from last 72h, or SQL count from last 24h)
- Maps to an action_name OR phase_id (sample / outreach / creator_match / paid_ads / live / reactivate / training / eval / data) when applicable
- For data_source findings: name the source (Airtable base/table, Monday board, Drive folder), the field(s) of interest, the SID table/column it should land in, and what action it would train

Quality bar per draft task (FLEET tracker pattern, modeled on bemomentiq/momentiq-dna#3604):
- Follows CC's POST /api/tasks/bulk schema exactly (see SCHEMA section below)
- agentBriefing is 8-H2 markdown (Goal, Context, Files, Implementation, Acceptance, Out-of-scope, Commit + PR, Notes)
- Title uses a canonical PHASE-AWARE prefix: 
    * Wire-up / DI / feature flags => \`CLASSIFIER-WIRE-N\`, \`FEATURE-WIRE-N\`, \`HANDLER-WIRE-N\`
    * Per-action backtest / fixtures => \`AUTONOMY-<ACTION_NAME_UPPER>\` (e.g. \`AUTONOMY-DISCOVER-CREATORS\`)
    * Eval dashboards / scorers / outcome joins => \`EVAL-<SHORT>\` (e.g. \`EVAL-OUTCOME-REWARD\`, \`EVAL-DASHBOARD\`)
    * Data ingest / backfill => \`DATA-<SHORT>\` (e.g. \`DATA-GMAIL\`, \`DATA-TTS-EVENTS\`)
    * Drift / retrain / rollback => \`DRIFT-<SHORT>\`, \`RETRAIN-<SHORT>\`, \`AUTO-ROLLBACK\`
    * Frontend wiring / training surfaces / eval dashboards => \`FE-<SHORT>\` (e.g. \`FE-TRAINING-QUEUE\`, \`FE-EVAL-DASH\`)
    * E2E campaign automation gaps => \`E2E-<SHORT>\` (e.g. \`E2E-PAID-ADS-LOOP\`, \`E2E-LIVE-AGENT\`)
- When you emit multiple sub-tasks that belong to the SAME AREA + PRIORITY + REPO, the Autonomy Hub will auto-batch them into a FLEET-style master tracker on GitHub (one parent issue + N child issues). The master includes \`## Current state\`, \`## Phases\` with checkbox children, \`## Constraints for all children\`, and \`## Branch for merge base\`. Your job is to make the children EASY to cluster:
    * give them consistent prefixes (same phase pattern)
    * make Goal lines short and orthogonal
    * use Out-of-scope to cite sibling prefixes (not issue numbers — those get assigned after master creation)
- When sibling-carving, every sibling references the others in Out-of-scope by [PREFIX-N]
- Has live-data citation in Context (count or error string from last 24h)
- Branch name in Commit + PR: \`feat/<area>-<prefix-lower>-<short>\` — matches FLEET convention (NOT \`fix/<task-slug>\`)
- Include a "Constraints" echo in Notes for FLEET-style compliance: \`- All LLM calls through CompletionProvider DI\` / \`- npx tsc --noEmit clean\` / \`- npx vitest run clean\`

OUTPUT FORMAT (STRICT JSON, no prose before/after):
\`\`\`json
{
  "summary": "<=600 char recap of this run",
  "next_gameplan": "<=400 char gameplan for next run — what to explore deeper next cycle",
  "next_pickup": "<=500 char chain handoff directive for the next Explorer run (see NEXT PICKUP DIRECTIVE above)",
  "findings": [{"severity":"high","category":"gap_to_prod","title":"…","body":"…","action_name":"…","phase_id":"…","evidence":["#3474","server/dispatch/recovery/usage-cap-deferral-gate.ts:143"]}, ...],
  "ledger_patterns": [{"pattern":"…","context":"…"}, ...],
  "draft_tasks": [{"title":"[AH-EXPLORE-1] …","description":"…","project_slug":"momentiq-dna","repo_url":"https://github.com/bemomentiq/momentiq-dna","priority":"p1","relevant_skills":["codex-fleet","sid-autonomy-actions-catalog"],"effort_estimate":"4 hrs","agent_briefing":"## Goal\\n…\\n\\n## Context\\n…\\n\\n## Files\\n…\\n\\n## Implementation\\n…\\n\\n## Acceptance\\n…\\n\\n## Out-of-scope\\n…\\n\\n## Commit + PR\\n…\\n\\n## Notes\\n…","batch_id":"ah-explore-2026-04-30"}, ...]
}
\`\`\`

POST your JSON payload to: PUT /api/explorer/runs/:run_id/ingest  on the Autonomy Hub server.`;

export async function buildExplorerPrompt(run_id: number): Promise<string> {
  const cfg = storage.getCronConfig();
  // Compact stale summaries before reading priors so we keep <=15 verbose entries.
  storage.compactStaleExplorerSummaries(cfg.max_prior_summaries);
  const priors = storage.priorRunSummaries(cfg.max_prior_summaries);
  const ledger = storage.listLedger(Math.min(30, cfg.max_ledger_entries));
  const openFindings = storage.listFindings({ status: "open", limit: 20 });

  // Surface which external data sources are wired so the Explorer knows when to propose data-mapping tasks
  const dataSources: string[] = [];
  if (cfg.airtable_api_key) dataSources.push("Airtable (key set; available via Hub config)");
  else dataSources.push("Airtable (NOT set — propose a DATA-AIRTABLE wire-up if a base would unblock training)");
  if (cfg.monday_api_key) dataSources.push("Monday (key set; available via Hub config)");
  else dataSources.push("Monday (NOT set — propose DATA-MONDAY when a board has training-relevant fields)");
  if (cfg.google_drive_oauth) dataSources.push("Google Drive (oauth set; available via Hub config)");
  else dataSources.push("Google Drive (NOT set — propose DATA-DRIVE when a folder has briefs/contracts/specs)");

  // Current platform snapshot
  const actionsSummary = ACTIONS.map((a) => {
    const x = getExtras(a.action_name);
    return `- ${a.action_name} (${a.class}#${a.action_number}) — prod:${a.prod_readiness_pct}% train:${a.training_backfill_pct}% eval:${a.eval_pass_pct ?? "-"}% gate:${a.hitl_gate} money_path:${x.money_path}`;
  }).join("\n");

  // Latest completed explorer run with a real next_pickup is the chain handoff
  const latestPickup = priors.find((p) => (p as any).next_pickup && !(p as any).next_pickup.startsWith("[compacted]"))?.next_pickup as string | null | undefined ?? null;
  const { pickupSection: explorerPickupSection, priorSection, ledgerSection } = buildFluidLoopContext({
    kind: "explorer",
    runId: run_id,
    priorRuns: priors.map((p) => ({
      id: p.id,
      started_at: p.started_at,
      summary: p.summary,
      next_pickup: (p as any).next_pickup ?? null,
      status: "completed",
    })),
    ledger: ledger.map((l) => ({ pattern: l.pattern, heat: l.heat, seen_count: l.seen_count })),
    latestPickup,
  });
  const openFindingsSection = openFindings.length ? openFindings.slice(0, 15).map((f) => `- #${f.id} [${f.severity}/${f.category}] ${f.title} → ${f.action_name || f.phase_id || "-"}`).join("\n") : "(no open findings)";
  const recentShips = LIVE_FEED.slice(0, 6).map((f) => `- ${f.date} #${f.number} ${f.title}`).join("\n");
  const blockers = OPEN_BLOCKERS.map((b) => `- #${b.number} ${b.title}`).join("\n");

  // Live Neon production signals (cached 10 min; graceful fallback when env var missing)
  const signalsResult = await fetchLiveSignals();
  let neonSignalsSection: string;
  if (!signalsResult.available) {
    neonSignalsSection = `(neon signals unavailable — ${signalsResult.reason})`;
  } else {
    const { topActions, queueDepth, hitlHours7d, fetchedAt } = signalsResult.data;
    const actionsTable = topActions.length
      ? topActions
          .map(
            (a) =>
              `  - ${a.action_name}: ${a.run_count} runs, ${(a.pass_rate * 100).toFixed(1)}% pass`
          )
          .join("\n")
      : "  (no runs in last 24h)";
    const queueTable = queueDepth.length
      ? queueDepth.map((q) => `  - ${q.status}: ${q.count}`).join("\n")
      : "  (queue empty)";
    neonSignalsSection = [
      `fetched_at: ${fetchedAt}`,
      ``,
      `### Top runs (last 24h)`,
      actionsTable,
      ``,
      `### Queue depth`,
      queueTable,
      ``,
      `### HITL hours (last 7d)`,
      `  ${hitlHours7d.toFixed(1)} hours`,
    ].join("\n");
  }

  // Kalodata companion signals (optional — fetches live readiness + roadmap state)
  let kalodataSection = "(kalodata signals not yet configured — set KALODATA_API_URL env var)";
  try {
    await fetchKalodataSignals(); // persists to readiness_snapshots if successful
    const readiness = await getLatestReadinessContext();
    const roadmap = await getLatestRoadmapContext();
    if (readiness !== "No readiness snapshot available yet." || roadmap !== "No roadmap state snapshot available yet.") {
      kalodataSection = `Readiness: ${readiness}\nRoadmap: ${roadmap}`;
    }
  } catch {
    // optional — never block on this
  }

  return [
    ROLE,
    "",
    `## LIVE PRODUCTION SIGNALS`,
    neonSignalsSection,
    "",
    `## KALODATA COMPANION SIGNALS`,
    kalodataSection,
    "",
    `# RUN CONTEXT`,
    `run_id: ${run_id}`,
    `model: ${cfg.model}`,
    `interval_minutes: ${cfg.interval_minutes}`,
    `max_ledger_entries: ${cfg.max_ledger_entries}`,
    `max_prior_summaries: ${cfg.max_prior_summaries}`,
    "",
    `# PICKUP DIRECTIVE (chain handoff from prior Explorer run)`,
    explorerPickupSection,
    "",
    `# PRIOR RUN SUMMARIES (latest ${priors.length}, not all-time)`,
    priorSection,
    "",
    `# LEARNING LEDGER (heat-sorted top 25, full = ${ledger.length}/${cfg.max_ledger_entries})`,
    ledgerSection,
    "",
    `# OPEN FINDINGS FROM PRIOR RUNS (${openFindings.length} total, showing 15)`,
    openFindingsSection,
    "",
    `# EXTERNAL DATA SOURCES`,
    dataSources.map((d) => `- ${d}`).join("\n"),
    cfg.focus_mission ? "" : "",
    cfg.focus_mission ? `# ACTIVE FOCUS MISSION (overrides default exploration when set)` : "",
    cfg.focus_mission ? cfg.focus_mission : "",
    "",
    `# 40-ACTION SNAPSHOT (from actions-seed.ts as of 2026-04-29)`,
    actionsSummary,
    "",
    `# RECENT GITHUB SHIPS (autonomy-related)`,
    recentShips,
    "",
    `# OPEN BLOCKERS`,
    blockers,
    "",
    `# YOUR TOOLS`,
    `- gh CLI (api_credentials=["github"]) for PRs, issues, commits`,
    `- pplx CLI (api_credentials=["pplx-sdk"]) for web search + fetch`,
    `- bash for reading local files in /home/user/workspace/autonomy-hub/`,
    `- Read /home/user/workspace/skills/user/ for active skill definitions`,
    `- curl the Autonomy Hub API locally: GET http://localhost:5000/api/actions, /api/rollups, /api/roadmap, /api/feed`,
    "",
    `### Phase 5b — END-OF-RUN ORGANIZER MICRO-PASS (mandatory, ≤5 min)`,
    `After you've filed your draft_tasks and ledger_patterns:`,
    ``,
    `1. Fetch the 20 most recently-created open issues you filed this run:`,
    `   gh issue list -R ${cfg.default_gh_repo} --state open --search "author:@me" --limit 20 --json number,title,labels`,
    ``,
    `2. For EACH issue you filed this run:`,
    `   a. Check for semantic duplicates against the 10 most recent prior issues (substring/fuzzy match on title + first 150 chars of body)`,
    `   b. If a near-duplicate exists, COMMENT on BOTH: "Sibling: #X — consolidate?" with a 1-sentence rationale`,
    `   c. Check that the issue body has all 8 required H2 headers (Goal, Context, Files, Implementation, Acceptance, Out-of-scope, Commit + PR, Notes). If missing any, EDIT the body to add the missing H2 with a brief placeholder`,
    ``,
    `3. Take a fast pass over the 100 oldest open issues:`,
    `   gh issue list -R ${cfg.default_gh_repo} --state open --limit 100 --sort created`,
    `   - Pick 3-5 obvious orphans (no epic parent reference in body) and add a comment "[ORGANIZER] Suggested parent epic: #Y (based on label affinity)"`,
    `   - Pick 2-3 issues with missing priority label and comment "[ORGANIZER] Suggested label: priority/p2"`,
    ``,
    `4. Report micropass stats in your next_gameplan field:`,
    `   "micropass: K dupes flagged, Y orphans suggested parents, Z briefings patched"`,
    ``,
    `DO NOT close issues during micropass — leave closure/merge to the dedicated Organizer cron.`,
    ``,
    `# INGEST ENDPOINT`,
    `Your final POST (once you have complete JSON): PUT ${process.env.NODE_ENV === "production" ? "https://momentiq-dna-hub.up.railway.app/port/5000" : "http://localhost:5000"}/api/explorer/runs/${run_id}/ingest`,
    `On success you'll get 200 with {"ok":true,"counts":{...}}.`,
    `If JSON fails Zod validation you'll get 400 — fix and retry.`,
    "",
    `Begin thinking deeply. Remember: compounding learning, not repetition.`,
  ].join("\n");
}

// Build a dispatch payload that can be handed to the Perplexity cron / run_subagent
export async function buildDispatchPayload(run_id: number) {
  const cfg = storage.getCronConfig();
  return {
    run_id,
    model: cfg.model,
    extended_context: false,
    subagent_type: "general_purpose",
    objective: await buildExplorerPrompt(run_id),
  };
}
