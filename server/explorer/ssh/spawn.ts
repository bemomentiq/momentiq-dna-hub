// spawnOnMini — spawn an agent on a Mini via CC remote-exec.
//
// Extracted from direct-ssh.ts (behavior-preserving modularization).

import type { MiniId, Provider } from "../direct-targets";
import { MINI_SSH_CONFIGS, PROVIDER_MODELS } from "../direct-targets";
import { storage } from "../../storage";
import { ccExecSync, leaseCodexCredential } from "./exec";
import { buildRunnerScript, buildSpawnCommand } from "./runner-script";

// ---------------------------------------------------------------------------
// Public API: spawnOnMini
// ---------------------------------------------------------------------------

export interface SpawnOnMiniOpts {
  mini: MiniId;
  provider: Provider;
  briefing: string;
  runId: number;
  hubStatusUrl: string;
  ccApiUrl: string;
  ccApiKey: string;
}

export interface SpawnOnMiniResult {
  ok: boolean;
  pid?: number;
  workdir?: string;
  model?: string;
  credentialId?: number;
  leasedEmail?: string;
  error?: string;
}

/**
 * Spawn an agent (codex or claude) on the given Mini via CC remote-exec.
 *
 * Steps:
 *   1. If codex: lease a credential from CC's pool (per-run isolation).
 *   2. Build runner.sh + spawn command (base64-encoded for SSH safety).
 *   3. POST to CC /api/remote/exec-sync with agentId=<mini>.
 *   4. Parse the echoed JSON for pid + workdir.
 *   5. Return SpawnOnMiniResult.
 *
 * SSH primitive ported from bemomentiq/momentiq-command-center
 * commit 875218d03e19bd1f25b08050382b1558b6d1ad28.
 */
export async function spawnOnMini(opts: SpawnOnMiniOpts): Promise<SpawnOnMiniResult> {
  const cfg = MINI_SSH_CONFIGS[opts.mini];
  const workdir = `${cfg.repoPath}/run-${opts.runId}`;
  const model = PROVIDER_MODELS[opts.provider];

  // Step 1: lease codex credential (if applicable)
  let credentialId: number | undefined;
  let leasedEmail: string | undefined;
  let codexAuthB64: string | undefined;

  if (opts.provider === "codex") {
    const lease = await leaseCodexCredential({
      ccApiUrl: opts.ccApiUrl,
      ccApiKey: opts.ccApiKey,
      clientId: `ah-cascade-r${opts.runId}-${opts.mini}`,
    });
    if (!lease.ok) {
      return {
        ok: false,
        error: `credential lease failed for ${opts.mini}/codex: ${lease.error}`,
      };
    }
    credentialId = lease.credentialId;
    leasedEmail = lease.email;
    codexAuthB64 = Buffer.from(lease.authJson!, "utf8").toString("base64");
  }

  // Step 2: build scripts (base64 to avoid every shell-quoting hazard)
  // Pull GH PAT from cron_config (auto-seeded on Hub boot from HARDCODED_GH_PAT)
  // and Anthropic/OpenAI keys from server env. Without GH_TOKEN exported into
  // the runner, every `gh issue list` / `gh pr create` / `git push` fails on
  // the Mini and the agent silently aborts (see runs #58-62, #73, #74).
  let githubToken: string | undefined;
  try {
    githubToken = (storage.getCronConfig() as any)?.github_token || undefined;
  } catch {
    // Storage not available (tests, dev) — continue without; agent will warn.
  }
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY || undefined;
  const openaiApiKey = process.env.OPENAI_API_KEY || undefined;

  const briefingB64 = Buffer.from(opts.briefing, "utf8").toString("base64");
  const runnerScript = buildRunnerScript({
    provider: opts.provider,
    workdir,
    briefingPath: `${workdir}/briefing.md`,
    githubToken,
    anthropicApiKey,
    openaiApiKey,
  });
  const runnerScriptB64 = Buffer.from(runnerScript, "utf8").toString("base64");

  const command = buildSpawnCommand({
    provider: opts.provider,
    mini: opts.mini,
    workdir,
    runId: opts.runId,
    briefingB64,
    runnerScriptB64,
    codexAuthB64,
    hubStatusUrl: opts.hubStatusUrl,
  });

  // Step 3: dispatch via CC remote-exec (which uses CC's SSHExecutor internally)
  const res = await ccExecSync({
    ccApiUrl: opts.ccApiUrl,
    ccApiKey: opts.ccApiKey,
    agentId: opts.mini,
    command,
    timeoutMs: 20_000,
  });

  if (!res.ok || res.exitCode !== 0) {
    return {
      ok: false,
      error: `spawn failed on ${opts.mini} (exit ${res.exitCode}): ${
        (res.stderr || res.stdout).slice(0, 400)
      }`,
    };
  }

  // Step 4: parse the JSON line echoed at the end
  let pid: number | undefined;
  try {
    const lastLine = res.stdout.trim().split(/\n/).pop() ?? "{}";
    pid = JSON.parse(lastLine).pid;
  } catch {
    // Tolerate missing PID — we can still inspect log files later
  }

  return {
    ok: true,
    pid,
    workdir,
    model,
    credentialId,
    leasedEmail,
  };
}
