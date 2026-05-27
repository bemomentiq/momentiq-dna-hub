// Ad-hoc "direct" dispatch path (executor === "pin-codex-direct" / "pin-claude-direct").
//
// HISTORY: "direct" used to mean "SSH straight into a Mac Mini and spawn the
// agent inline, bypassing CC's queue". That mini path (mini-4 / mini-5) broke
// when CC migrated onto GKE Codex Lanes. The pin-*-direct executors are kept as
// a user-facing option, but they now enqueue a CC task tagged with the DNA
// project id (project 14920) just like every other lane — CC schedules it onto
// a GKE codex-lane. The exported surface (spawnDirectAgent / pollDirectRun /
// reapDeadDirectRuns / DIRECT_TARGETS / isDirectExecutor) is unchanged so
// fleet-routes is untouched apart from how the marker is stored.

import { storage } from "../storage";
import { postTask, getTaskStatus, PROVIDER_MODELS, type Provider } from "./cc-dispatch";
import { buildDirectMarker, parseDirectMarker } from "./cascade-dispatch";

// ---------------------------------------------------------------------------
// Executor → provider/model map for the pin-*-direct options.
// (Previously keyed mini-5; the agentId is now CC-assigned, not a Mini.)
// ---------------------------------------------------------------------------
export const DIRECT_TARGETS = {
  "pin-codex-direct": { agentId: "cc", agent: "codex", model: PROVIDER_MODELS.codex },
  "pin-claude-direct": { agentId: "cc", agent: "claude", model: PROVIDER_MODELS.claude },
} as const;

export type DirectExecutor = keyof typeof DIRECT_TARGETS;

export function isDirectExecutor(executor: string): executor is DirectExecutor {
  return executor === "pin-codex-direct" || executor === "pin-claude-direct";
}

// ---------------------------------------------------------------------------
// spawnDirectAgent — enqueue a CC task for a pin-*-direct ad-hoc / replay run.
// ---------------------------------------------------------------------------
export async function spawnDirectAgent(opts: {
  cc_api_url: string;
  cc_api_key: string;
  executor: DirectExecutor;
  run_id: number;
  agent_briefing: string;
  hub_status_url: string;
  repo_url: string;
}): Promise<{
  ok: boolean;
  ccTaskId?: number;
  agentId: string;
  agent: "codex" | "claude";
  model: string;
  directMarker?: string;
  workdir?: string;
  error?: string;
}> {
  const provider: Provider = opts.executor === "pin-codex-direct" ? "codex" : "claude";

  const posted = await postTask({
    ccApiUrl: opts.cc_api_url,
    ccApiKey: opts.cc_api_key,
    title: `[AH-DIRECT-R${opts.run_id}] direct ${provider} run`,
    description: `Autonomy Hub direct (${opts.executor}) run #${opts.run_id} → GKE codex-lane via CC. Status reported to ${opts.hub_status_url}.`,
    briefing: opts.agent_briefing,
    repoUrl: opts.repo_url,
    provider,
    priority: "p0",
  });

  if (!posted.ok) {
    return { ok: false, agentId: "cc", agent: provider, model: PROVIDER_MODELS[provider], error: posted.error };
  }

  return {
    ok: true,
    ccTaskId: posted.ccTaskId,
    agentId: "cc",
    agent: provider,
    model: posted.model ?? PROVIDER_MODELS[provider],
    directMarker: buildDirectMarker({ provider, ccTaskId: posted.ccTaskId, cascadeIndex: 0 }),
  };
}

// ---------------------------------------------------------------------------
// pollDirectRun — query a CC task's state, shaped like the old SSH poll result
// so the /api/fleet/runs/:id/poll route and the reaper are unchanged in spirit.
// ---------------------------------------------------------------------------
export async function pollDirectRun(opts: {
  cc_api_url: string;
  cc_api_key: string;
  ccTaskId: number;
}): Promise<{
  ok: boolean;
  alive: boolean;
  exited?: boolean;
  stdout_tail: string;
  stderr_tail: string;
  exit_signal?: string;
  agentId?: string;
  error?: string;
}> {
  const s = await getTaskStatus({ ccApiUrl: opts.cc_api_url, ccApiKey: opts.cc_api_key, ccTaskId: opts.ccTaskId });
  if (!s.ok) {
    return { ok: false, alive: false, stdout_tail: "", stderr_tail: "", error: s.error };
  }
  const status = (s.status ?? "").toLowerCase();
  const terminal = status === "completed" || status === "failed" || status === "cancelled";
  const failed = status === "failed" || status === "cancelled";
  return {
    ok: true,
    alive: !terminal,
    exited: terminal,
    stdout_tail: s.logTail ?? s.summary ?? "",
    stderr_tail: failed ? (s.summary ?? s.status ?? "") : "",
    exit_signal: terminal ? (failed ? "1" : "0") : undefined,
    agentId: s.agentId,
  };
}

// ---------------------------------------------------------------------------
// Reaper — finalize direct runs whose CC task has reached a terminal state.
// ---------------------------------------------------------------------------
export async function reapDeadDirectRuns(opts: {
  cc_api_url: string;
  cc_api_key: string;
}): Promise<{ scanned: number; reaped: number }> {
  const runs = storage.listFleetRuns({ status: "running", limit: 100 });
  const direct = runs.filter(
    (r) => r.executor === "pin-codex-direct" || r.executor === "pin-claude-direct",
  );

  let reaped = 0;
  for (const r of direct) {
    const markerStr =
      (r as any).direct_marker ||
      (r.error?.startsWith("direct:") ? r.error.replace(/^direct:/, "") : "");
    const parsed = parseDirectMarker(markerStr);
    if (!parsed?.ccTaskId) continue;

    const polled = await pollDirectRun({
      cc_api_url: opts.cc_api_url,
      cc_api_key: opts.cc_api_key,
      ccTaskId: parsed.ccTaskId,
    });

    if (polled.ok && polled.exited) {
      const finalStatus = polled.exit_signal?.trim() === "0" ? "completed" : "failed";
      const summary = polled.stdout_tail
        .trim()
        .split("\n")
        .slice(-3)
        .join(" │ ")
        .slice(0, 500) || "(empty CC log)";
      storage.updateFleetRun(r.id, {
        status: finalStatus,
        finished_at: new Date().toISOString(),
        summary,
        error: finalStatus === "failed" ? polled.stderr_tail.slice(-500) : null,
      });
      reaped++;
    }
  }

  return { scanned: direct.length, reaped };
}
