// Consolidation cron lane (5th lane).
// Fires every N hours (consolidation_cron_interval_hours, default 1h).
// Instead of running locally, it POSTs the consolidation briefing as a CC task
// to /api/tasks, letting the fleet poll + claim. Round-robins mini-1..mini-5.

import { storage } from "../storage";

const CC_API = process.env.CC_API_URL || "https://command-center-api-production-96e2.up.railway.app";
const CC_KEY = process.env.CC_API_KEY || process.env.AGENT_API_KEY || "miq-cmd-center-2026";

const MINIS = ["mini-1", "mini-2", "mini-3", "mini-4", "mini-5"];

function pickHealthyMini(): string {
  const cfg = storage.getCronConfig() as any;
  const idx = ((cfg.consolidation_last_mini_idx ?? 0) % MINIS.length);
  storage.updateCronConfig({ consolidation_last_mini_idx: idx + 1 } as any);
  return MINIS[idx];
}

export async function dispatchConsolidationToCC(): Promise<{ ok: boolean; task_id?: number; error?: string }> {
  const cfg = storage.getCronConfig() as any;
  const gist: string = cfg.consolidation_briefing_gist || "";
  if (!gist) return { ok: false, error: "no consolidation_briefing_gist configured" };

  const intervalHours: number = cfg.consolidation_cron_interval_hours ?? 1;
  const firedAt = new Date().toISOString();

  const briefing = `## Goal
Fetch the full consolidation briefing from ${gist} and execute end-to-end. Consolidate all from-explorer-* labeled issues on bemomentiq/momentiq-dna into a clean 6-phase Epic->Task hierarchy with EV scores. Dedupe + merge duplicates.

## Context
Continual consolidation lane. Fired by momentiq-dna-hub's consolidation_cron every ${intervalHours}h. Hub run record N/A (CC-routed). Fired at ${firedAt}.

## Files
- /tmp/briefing.md after curl fetch
- /tmp/dna-final-hierarchy.md (deliverable)
- GitHub issues on bemomentiq/momentiq-dna

## Implementation
1. curl -sS -o /tmp/briefing.md '${gist}'
2. cat /tmp/briefing.md
3. Execute every phase 0-5 of the briefing.

## Acceptance
- 6 phase trackers exist with proper child-epic checkboxes
- Every from-explorer-* issue is parented (kept / merged / absorbed)
- Every epic has phase-N + ev:<score> + effort:S/M/L labels
- /tmp/dna-final-hierarchy.md rendered cleanly with stats

## Out-of-scope
- No code changes
- Don't touch repos other than bemomentiq/momentiq-dna

## Commit + PR
- No PR (backlog organization run)

## Notes
- Idempotent — safe to run hourly; skip work that's already done
- Fired by momentiq-dna-hub at ${firedAt}`;

  const payload = {
    projectSlug: "momentiq-dna",
    title: `[DNA-CONSOLIDATION-CRON] ${firedAt.slice(0, 16)}Z auto-consolidation`,
    description: "Hourly auto-consolidation of from-explorer-* issues",
    agentBriefing: briefing,
    status: "planned",
    priority: "p2",
    executor: pickHealthyMini(),
    taskType: "dev_task",
    repoUrl: "https://github.com/bemomentiq/momentiq-dna",
    automatable: true,
    effortEstimate: "medium",
    relevantSkills: ["auto-build"],
    laneAffinity: "claude",
  };

  try {
    const r = await fetch(`${CC_API}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": CC_KEY },
      body: JSON.stringify(payload),
    });
    if (!r.ok) return { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
    const j = (await r.json()) as any;
    storage.updateCronConfig({
      consolidation_last_run_at: firedAt,
      consolidation_last_cc_task_id: j.id,
    } as any);
    console.log(`[consolidation-cron] dispatched CC task #${j.id}`);
    return { ok: true, task_id: j.id };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
