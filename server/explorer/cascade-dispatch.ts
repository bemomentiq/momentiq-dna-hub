// Fleet dispatch orchestrator for cron-triggered Explorer / Executor / Audit /
// Test-Debug runs.
//
// HISTORY: this module used to run a 4-way SSH fallback cascade across
// mini-4/mini-5 × codex/claude. That direct-SSH path broke when CC migrated
// off the Mac Minis onto GKE Codex Lanes (gke-codex-lane-1..13). It now routes
// every run through CC's task queue (project 14920) via ./cc-dispatch, and CC
// schedules the work onto a GKE codex-lane. The public surface
// (dispatchWithCascade + the marker / stats helpers) is unchanged so callers in
// fleet-routes / explorer routes / test-debug / server routes are untouched.

import { postTask, PROVIDER_MODELS, type Provider } from "./cc-dispatch";

const DEFAULT_REPO_URL = "https://github.com/bemomentiq/momentiq-dna";

export interface CascadeAttempt {
  target: { provider: Provider; lane?: string };
  result: "ok" | "fail";
  error?: string;
}

export interface CascadeDispatchOpts {
  kind: "explorer" | "executor";
  runId: number;
  briefing: string;
  preferredProvider?: Provider;
  /** Legacy hint (was the target Mini); ignored now that CC schedules the lane. */
  preferredMini?: string;
  repoUrl?: string;
  hubStatusUrl: string;
  ccApiUrl: string;
  ccApiKey: string;
}

export interface CascadeDispatchResult {
  ok: boolean;
  finalTarget?: { provider: Provider; lane?: string };
  cascadeIndex?: number; // retained for API back-compat; always 0 on the CC path
  attempts: CascadeAttempt[];
  ccTaskId?: number;
  pid?: number; // legacy field — undefined on the CC path
  workdir?: string; // legacy field — undefined on the CC path
  model?: string;
  credentialId?: number;
  leasedEmail?: string;
  directMarker?: string; // stored in direct_marker; now carries cc_task_id
  error?: string;
}

/**
 * Dispatch a run by enqueuing a CC task tagged with the DNA project id.
 *
 * Replaces the old SSH cascade: CC owns lane selection + resilience, so there
 * is a single attempt here. The chosen provider maps to a CC executor pin
 * (codex → pin-codex / gpt_5_5, claude → pin-claude / opus).
 */
export async function dispatchWithCascade(
  opts: CascadeDispatchOpts,
): Promise<CascadeDispatchResult> {
  const provider: Provider = opts.preferredProvider ?? "codex";
  const attempts: CascadeAttempt[] = [];

  const posted = await postTask({
    ccApiUrl: opts.ccApiUrl,
    ccApiKey: opts.ccApiKey,
    title: `[AH-${opts.kind.toUpperCase()}-R${opts.runId}] ${opts.kind} run`,
    description: `Autonomy Hub ${opts.kind} run #${opts.runId} dispatched to a GKE codex-lane via CC. Progress is reported back to ${opts.hubStatusUrl}.`,
    briefing: opts.briefing,
    repoUrl: opts.repoUrl ?? DEFAULT_REPO_URL,
    provider,
    priority: opts.kind === "executor" ? "p1" : "p2",
  });

  attempts.push({
    target: { provider },
    result: posted.ok ? "ok" : "fail",
    error: posted.error,
  });

  if (!posted.ok) {
    return { ok: false, attempts, error: `CC dispatch failed: ${posted.error}` };
  }

  const directMarker = buildDirectMarker({
    provider,
    ccTaskId: posted.ccTaskId,
    cascadeIndex: 0,
  });

  return {
    ok: true,
    finalTarget: { provider },
    cascadeIndex: 0,
    attempts,
    ccTaskId: posted.ccTaskId,
    model: posted.model ?? PROVIDER_MODELS[provider],
    directMarker,
  };
}

// ---------------------------------------------------------------------------
// Direct marker format
// ---------------------------------------------------------------------------

/**
 * Build the direct_marker string stored on fleet_runs / explorer_runs.
 * Format: agentId=<lane>;provider=<provider>;cc_task_id=<id>;cascade_index=0
 *
 * (Older rows used pid=/workdir= from the SSH path; parseDirectMarker still
 * reads those for historical runs.)
 */
export function buildDirectMarker(opts: {
  provider: Provider;
  ccTaskId?: number;
  agentId?: string;
  cascadeIndex?: number;
}): string {
  return [
    `agentId=${opts.agentId ?? "cc"}`,
    `provider=${opts.provider}`,
    `cc_task_id=${opts.ccTaskId ?? "unknown"}`,
    `cascade_index=${opts.cascadeIndex ?? 0}`,
  ].join(";");
}

/**
 * Parse a direct_marker string back into its components.
 * Returns null if the marker is malformed or absent.
 */
export function parseDirectMarker(marker: string | null | undefined): {
  agentId: string;
  provider: string;
  ccTaskId: number | null;
  pid: number | null;
  workdir: string;
  cascadeIndex: number;
} | null {
  if (!marker) return null;
  const get = (key: string): string | null => {
    const m = new RegExp(`${key}=([^;]+)`).exec(marker);
    return m ? m[1] : null;
  };
  const agentId = get("agentId");
  const provider = get("provider");
  if (!agentId || !provider) return null;
  const pidStr = get("pid");
  const ccStr = get("cc_task_id");
  const idxStr = get("cascade_index");
  return {
    agentId,
    provider,
    ccTaskId: ccStr && ccStr !== "unknown" ? parseInt(ccStr, 10) : null,
    pid: pidStr && pidStr !== "unknown" ? parseInt(pidStr, 10) : null,
    workdir: get("workdir") ?? "",
    cascadeIndex: idxStr ? parseInt(idxStr, 10) : 0,
  };
}

// ---------------------------------------------------------------------------
// cascade_stats helper (for /api/autonomy/status)
// ---------------------------------------------------------------------------

export interface CascadeStats {
  mini4_codex: number;
  mini4_claude: number;
  mini5_codex: number;
  mini5_claude: number;
}

/**
 * Compute cascade_stats from a set of direct_marker strings. Counts how many
 * historical runs landed on each (legacy) mini×provider combination. New runs
 * land on CC-scheduled GKE lanes and no longer contribute to these counts.
 */
export function computeCascadeStats(markers: Array<string | null | undefined>): CascadeStats {
  const stats: CascadeStats = { mini4_codex: 0, mini4_claude: 0, mini5_codex: 0, mini5_claude: 0 };
  for (const m of markers) {
    const parsed = parseDirectMarker(m);
    if (!parsed) continue;
    const key = `${parsed.agentId.replace("-", "")}_${parsed.provider}` as keyof CascadeStats;
    if (key in stats) {
      stats[key as keyof CascadeStats]++;
    }
  }
  return stats;
}
