// Dispatches a consolidation run as a CC task via /api/tasks endpoint.
// Selects the least-loaded Mini from the round-robin pool (mini-1..5).

import { storage } from "../storage";

const CC_API_URL = process.env.CC_API_URL ?? "https://command-center-api-production-96e2.up.railway.app";
const CC_API_KEY = process.env.CC_API_KEY ?? process.env.AGENT_API_KEY ?? "miq-cmd-center-2026";

// Mini fleet pool — round-robin by created_at of most recent consolidation CC task
const MINI_EXECUTORS = ["mini-1", "mini-2", "mini-3", "mini-4", "mini-5"];

function pickExecutor(): string {
  // Simple round-robin: pick based on count of recent consolidation tasks
  // In absence of tracking, just default to mini-1 through mini-5 cycling by time
  const idx = Math.floor(Date.now() / (3600 * 1000)) % MINI_EXECUTORS.length;
  return MINI_EXECUTORS[idx];
}

export interface ConsolidationDispatchResult {
  ok: boolean;
  cc_task_id?: number;
  executor?: string;
  error?: string;
}

export async function dispatchConsolidationToCC(): Promise<ConsolidationDispatchResult> {
  const cfg = storage.getCronConfig() as any;
  const briefingGist = cfg.consolidation_briefing_gist as string;
  const executor = pickExecutor();

  // Fetch the briefing content
  let briefingBody: string;
  try {
    const res = await fetch(briefingGist);
    briefingBody = res.ok ? await res.text() : `Fetch failed (${res.status}): ${briefingGist}`;
  } catch (err: any) {
    briefingBody = `Fetch error: ${err?.message ?? err}`;
  }

  const now = new Date().toISOString();
  const payload = {
    title: `[DNA-CONSOLIDATION-CRON] Consolidation run ${now.slice(0, 16)}`,
    description: `Automated consolidation run dispatched by momentiq-dna-hub at ${now}`,
    agentBriefing: briefingBody,
    projectSlug: cfg.default_cc_project_slug ?? "momentiq-dna",
    repoUrl: "https://github.com/bemomentiq/momentiq-dna-hub",
    priority: "p2",
    taskType: "dev_task",
    automatable: true,
    executor,
    effortEstimate: "30 min",
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
    // Update cron_config with last run info
    storage.updateCronConfig({
      consolidation_last_run_at: now,
      consolidation_last_cc_task_id: cc_task_id,
    } as any);
    return { ok: true, cc_task_id, executor };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
