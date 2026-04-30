// Direct-tunnel dispatch path. Bypasses CC's task queue entirely by calling
// CC's /api/remote/exec-sync to SSH into a specific Mac Mini and spawn the
// agent (codex or claude) inline as a backgrounded process.
//
// Why: lets the Autonomy Hub run concurrent fleet work without waiting on
// CC's FIFO queue. Used when executor === "pin-codex-direct" or "pin-claude-direct".
//
// REFACTORED: duplicate logic extracted into:
//   direct-targets.ts  — MINI_SSH_CONFIGS, DIRECT_TARGETS, cascade helpers
//   direct-ssh.ts      — spawnOnMini, pollMiniRun (SSH primitive, ported from CC)
//   cascade-dispatch.ts — 4-way fallback orchestrator
//
// This file now delegates to those modules and exists for back-compat only.
// Callers that import DIRECT_TARGETS / isDirectExecutor / DirectExecutor still work.

import { storage } from "../storage";
import { spawnOnMini, pollMiniRun } from "./direct-ssh";
import { buildDirectMarker } from "./cascade-dispatch";

// ---------------------------------------------------------------------------
// Back-compat re-exports (used by fleet-routes.ts ad-hoc paths)
// ---------------------------------------------------------------------------
export {
  LEGACY_DIRECT_TARGETS as DIRECT_TARGETS,
  isDirectExecutor,
  type DirectExecutor,
} from "./direct-targets";

// ---------------------------------------------------------------------------
// Legacy spawnDirectAgent — kept for ad-hoc pin-codex-direct / pin-claude-direct
// calls from /api/run/dispatch. Delegates to spawnOnMini from direct-ssh.ts.
// ---------------------------------------------------------------------------
export async function spawnDirectAgent(opts: {
  cc_api_url: string;
  cc_api_key: string;
  executor: "pin-codex-direct" | "pin-claude-direct";
  run_id: number;
  agent_briefing: string;
  hub_status_url: string;
  repo_url: string;
}): Promise<{
  ok: boolean;
  pid?: number;
  agentId: string;
  agent: "codex" | "claude";
  model: string;
  workdir: string;
  log_path: string;
  err_path: string;
  pid_path: string;
  credential_id?: number;
  leased_email?: string;
  error?: string;
}> {
  // pin-codex-direct → mini-5/codex (legacy behaviour: always mini-5)
  // pin-claude-direct → mini-5/claude
  const provider = opts.executor === "pin-codex-direct" ? ("codex" as const) : ("claude" as const);
  const mini = "mini-5" as const;

  const result = await spawnOnMini({
    mini,
    provider,
    briefing: opts.agent_briefing,
    runId: opts.run_id,
    hubStatusUrl: opts.hub_status_url,
    ccApiUrl: opts.cc_api_url,
    ccApiKey: opts.cc_api_key,
  });

  const workdir = result.workdir ?? `/Users/alex/hub-runs/run-${opts.run_id}`;
  const log_path = `${workdir}/out.log`;
  const err_path = `${workdir}/err.log`;
  const pid_path = `${workdir}/agent.pid`;

  if (!result.ok) {
    return {
      ok: false,
      agentId: mini,
      agent: provider,
      model: result.model ?? "unknown",
      workdir,
      log_path,
      err_path,
      pid_path,
      error: result.error,
    };
  }

  return {
    ok: true,
    pid: result.pid,
    agentId: mini,
    agent: provider,
    model: result.model ?? "unknown",
    workdir,
    log_path,
    err_path,
    pid_path,
    credential_id: result.credentialId,
    leased_email: result.leasedEmail,
  };
}

// ---------------------------------------------------------------------------
// Legacy pollDirectRun — delegates to pollMiniRun from direct-ssh.ts
// ---------------------------------------------------------------------------
export async function pollDirectRun(opts: {
  cc_api_url: string;
  cc_api_key: string;
  agentId: string;
  workdir: string;
  pid?: number;
}): Promise<{
  ok: boolean;
  alive: boolean;
  exited?: boolean;
  stdout_tail: string;
  stderr_tail: string;
  exit_signal?: string;
  error?: string;
}> {
  // Validate agentId is a known mini
  const mini = (opts.agentId === "mini-4" || opts.agentId === "mini-5")
    ? (opts.agentId as "mini-4" | "mini-5")
    : ("mini-5" as const); // fallback for legacy "mini-5" strings

  const result = await pollMiniRun({
    ccApiUrl: opts.cc_api_url,
    ccApiKey: opts.cc_api_key,
    mini,
    workdir: opts.workdir,
    pid: opts.pid,
  });

  return {
    ok: result.ok,
    alive: result.alive,
    exited: result.exited,
    stdout_tail: result.stdoutTail,
    stderr_tail: result.stderrTail,
    exit_signal: result.exitSignal,
    error: result.error,
  };
}

// ---------------------------------------------------------------------------
// Reaper — unchanged logic, now uses the new poll helper
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

    // Support both old format: agentId=<id>;pid=<N>;workdir=<path>
    // and new format: agentId=<id>;provider=<p>;pid=<N>;workdir=<path>;cascade_index=<N>
    const marker = markerStr.match(/agentId=([^;]+);(?:provider=[^;]+;)?pid=(\d+);workdir=([^;]+)/);
    if (!marker) continue;
    const [, agentId, pidStr, workdir] = marker;

    const polled = await pollDirectRun({
      cc_api_url: opts.cc_api_url,
      cc_api_key: opts.cc_api_key,
      agentId,
      workdir,
      pid: parseInt(pidStr, 10),
    });

    if (polled.ok && polled.exited) {
      const exitCode = polled.exit_signal?.trim();
      const finalStatus = exitCode === "0" ? "completed" : "failed";
      const summary = polled.stdout_tail
        .trim()
        .split("\n")
        .slice(-3)
        .join(" \u2502 ")
        .slice(0, 500) || "(empty stdout)";
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
