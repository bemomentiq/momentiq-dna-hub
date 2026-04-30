// 4-way fallback cascade orchestrator for Autonomy Hub direct-dispatch.
//
// Replaces the CC bulk-queue path for cron-triggered Explorer + Executor runs.
// Ad-hoc /api/run/dispatch can still use CC or the pin-*-direct path.
//
// Cascade order (per AH-DIRECT-CASCADE spec):
//   0. mini-4 + requested provider      (primary)
//   1. mini-5 + same provider           (other mini, same provider)
//   2. mini-4 + other provider          (same mini, other provider)
//   3. mini-5 + other provider          (full fallback)
//
// On success the direct_marker format is:
//   agentId=<mini>;provider=<provider>;pid=<N>;workdir=<path>;cascade_index=<0..3>
// This lets /api/autonomy/status show which fallback level was used.

import { cascadeFor, defaultTarget, type MiniId, type Provider } from "./direct-targets";
import { spawnOnMini } from "./direct-ssh";

export interface CascadeAttempt {
  target: { mini: MiniId; provider: Provider };
  result: "ok" | "fail";
  error?: string;
}

export interface CascadeDispatchOpts {
  kind: "explorer" | "executor";
  runId: number;
  briefing: string;
  preferredProvider?: Provider;
  preferredMini?: MiniId;
  hubStatusUrl: string;
  ccApiUrl: string;
  ccApiKey: string;
}

export interface CascadeDispatchResult {
  ok: boolean;
  finalTarget?: { mini: MiniId; provider: Provider };
  cascadeIndex?: number;   // 0-3 — which fallback level succeeded
  attempts: CascadeAttempt[];
  pid?: number;
  workdir?: string;
  model?: string;
  credentialId?: number;
  leasedEmail?: string;
  directMarker?: string;   // stored in direct_marker column
  error?: string;
}

/**
 * Attempt to spawn a run through the 4-way fallback cascade.
 *
 * Tries each target in cascade order; stops and returns on the first
 * successful spawn. If all 4 targets fail, returns ok=false with all
 * attempt errors.
 */
export async function dispatchWithCascade(
  opts: CascadeDispatchOpts,
): Promise<CascadeDispatchResult> {
  const primary = {
    mini: opts.preferredMini ?? defaultTarget().mini,
    provider: opts.preferredProvider ?? defaultTarget().provider,
  };
  const cascade = cascadeFor(primary);
  const attempts: CascadeAttempt[] = [];

  for (let i = 0; i < cascade.length; i++) {
    const target = cascade[i];
    const spawnResult = await spawnOnMini({
      mini: target.mini,
      provider: target.provider,
      briefing: opts.briefing,
      runId: opts.runId,
      hubStatusUrl: opts.hubStatusUrl,
      ccApiUrl: opts.ccApiUrl,
      ccApiKey: opts.ccApiKey,
    });

    attempts.push({
      target,
      result: spawnResult.ok ? "ok" : "fail",
      error: spawnResult.error,
    });

    if (spawnResult.ok) {
      const directMarker = buildDirectMarker({
        mini: target.mini,
        provider: target.provider,
        pid: spawnResult.pid,
        workdir: spawnResult.workdir ?? "",
        cascadeIndex: i,
      });

      return {
        ok: true,
        finalTarget: target,
        cascadeIndex: i,
        attempts,
        pid: spawnResult.pid,
        workdir: spawnResult.workdir,
        model: spawnResult.model,
        credentialId: spawnResult.credentialId,
        leasedEmail: spawnResult.leasedEmail,
        directMarker,
      };
    }
  }

  return {
    ok: false,
    attempts,
    error: `All 4 cascade targets failed. Attempts: ${attempts.map((a) => `${a.target.mini}/${a.target.provider}: ${a.error}`).join("; ")}`,
  };
}

// ---------------------------------------------------------------------------
// Direct marker format
// ---------------------------------------------------------------------------

/**
 * Build the direct_marker string stored on fleet_runs / explorer_runs.
 * Format: agentId=<mini>;provider=<provider>;pid=<N>;workdir=<path>;cascade_index=<0..3>
 *
 * Exported so routes.ts can parse it for /api/autonomy/status cascade_stats.
 */
export function buildDirectMarker(opts: {
  mini: MiniId;
  provider: Provider;
  pid?: number;
  workdir: string;
  cascadeIndex: number;
}): string {
  return [
    `agentId=${opts.mini}`,
    `provider=${opts.provider}`,
    `pid=${opts.pid ?? "unknown"}`,
    `workdir=${opts.workdir}`,
    `cascade_index=${opts.cascadeIndex}`,
  ].join(";");
}

/**
 * Parse a direct_marker string back into its components.
 * Returns null if the marker is malformed or absent.
 */
export function parseDirectMarker(marker: string | null | undefined): {
  agentId: string;
  provider: string;
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
  const workdir = get("workdir");
  if (!agentId || !provider || !workdir) return null;
  const pidStr = get("pid");
  const idxStr = get("cascade_index");
  return {
    agentId,
    provider,
    pid: pidStr && pidStr !== "unknown" ? parseInt(pidStr, 10) : null,
    workdir,
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
 * Compute cascade_stats from the last N direct_marker strings.
 * Counts how many runs landed on each mini×provider combination.
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
