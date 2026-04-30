// SSH-via-CC spawn primitive for Autonomy Hub direct-dispatch.
//
// SSH primitive ported from bemomentiq/momentiq-command-center
// commit 875218d03e19bd1f25b08050382b1558b6d1ad28 — keep in sync with that.
//
// CC's key modules ported / simplified here:
//   server/dispatch/ssh-executor.ts       — SSHExecutor + execBackground pattern
//   server/dispatch/dispatcher/executor-selection/ssh-config-builder.ts — SSH config
//   server/dispatch/dispatcher/executor-selection/remote-script-factory.ts — runner.sh
//   server/remote/routes/exec.ts          — /api/remote/exec-sync wire format
//   server/fleet/credentials/pool.ts      — credential lease API
//
// The Hub does NOT link directly to CC's SSH library (different process/host).
// Instead it calls CC's /api/remote/exec-sync endpoint, which uses CC's
// SSHExecutor internally and returns stdout/stderr/exitCode. This means:
//   - The Hub doesn't need an SSH key of its own.
//   - CC's resilience layer (retry, bulkhead, auth-fail rotation) is
//     automatically in play.
//   - The payload is identical to what CC does natively.

import type { MiniId, Provider } from "./direct-targets";
import { MINI_SSH_CONFIGS, PROVIDER_MODELS } from "./direct-targets";
import { storage } from "../storage";

// ---------------------------------------------------------------------------
// CC remote-exec client
// ---------------------------------------------------------------------------

/**
 * Call CC /api/remote/exec-sync to run a command synchronously on a Mini.
 * Mirrors the shape of CC's `exec.ts` POST /exec-sync endpoint exactly.
 */
async function ccExecSync(opts: {
  ccApiUrl: string;
  ccApiKey: string;
  agentId: string;
  command: string;
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  commandId?: number;
}> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), (opts.timeoutMs ?? 30_000) + 5_000); // 5s grace over command timeout
  try {
    const r = await fetch(`${opts.ccApiUrl}/api/remote/exec-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.ccApiKey,
      },
      body: JSON.stringify({
        agentId: opts.agentId,
        command: opts.command,
        timeoutMs: opts.timeoutMs ?? 30_000,
        skipNormalize: true, // our commands are already well-formed
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const text = await r.text();
      return {
        ok: false,
        stdout: "",
        stderr: `CC ${r.status}: ${text.slice(0, 300)}`,
        exitCode: -1,
      };
    }
    const j = (await r.json()) as any;
    return {
      ok: j.ok === true || j.exitCode === 0,
      stdout: j.stdout ?? "",
      stderr: j.stderr ?? "",
      exitCode: j.exitCode ?? -1,
      commandId: j.commandId,
    };
  } catch (err: any) {
    return {
      ok: false,
      stdout: "",
      stderr: err?.name === "AbortError" ? `CC exec timed out after ${opts.timeoutMs}ms` : (err?.message ?? String(err)),
      exitCode: -1,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Credential lease
// ---------------------------------------------------------------------------

/**
 * Lease a non-burned codex credential from CC's pool.
 * Returns the auth.json blob that codex CLI reads from $CODEX_HOME/auth.json.
 *
 * Mirrors leaseCodexCredential() in the original direct-dispatch.ts.
 */
async function leaseCodexCredential(opts: {
  ccApiUrl: string;
  ccApiKey: string;
  clientId: string;
}): Promise<{
  ok: boolean;
  credentialId?: number;
  email?: string;
  authJson?: string;
  error?: string;
}> {
  try {
    const r = await fetch(`${opts.ccApiUrl}/api/fleet/credentials/lease`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": opts.ccApiKey,
      },
      body: JSON.stringify({ product: "codex", client_id: opts.clientId }),
    });
    if (!r.ok) {
      return { ok: false, error: `lease ${r.status}: ${(await r.text()).slice(0, 300)}` };
    }
    const d = (await r.json()) as any;
    if (!d.ok || !d.tokens?.access_token) {
      return { ok: false, error: `lease returned no tokens: ${JSON.stringify(d).slice(0, 200)}` };
    }
    // Build the codex auth.json shape the CLI reads from $CODEX_HOME
    const authJson = JSON.stringify({
      OPENAI_API_KEY: null,
      auth_mode: "chatgpt",
      last_refresh: new Date().toISOString(),
      tokens: {
        access_token: d.tokens.access_token,
        id_token: d.tokens.id_token,
        refresh_token: d.tokens.refresh_token,
        account_id: d.accountId,
      },
    });
    return { ok: true, credentialId: d.id, email: d.email, authJson };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ---------------------------------------------------------------------------
// Runner script generation
// ---------------------------------------------------------------------------

/**
 * Build the runner.sh content for a given provider.
 *
 * Mirrors the runner script pattern from direct-dispatch.ts, ported from CC's
 * remote-script-factory.ts (nohup + < /dev/null stdin redirect + exitcode stamp).
 * The base64-encode-over-SSH pattern bypasses all shell quoting hazards.
 */
function buildRunnerScript(opts: {
  provider: Provider;
  workdir: string;
  briefingPath: string;
  githubToken?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}): string {
  // PATH-hardening: nohup-spawned bash on macOS Minis does NOT inherit the user's
  // login shell PATH. CC's /api/remote/exec-sync sometimes runs commands in a
  // context where /opt/homebrew/bin is missing, causing `exec: claude: not found`
  // (exit 127) the moment the runner tries to launch the agent. We saw this with
  // runs #58-62 and again with #73/#74 — agents never started, no PATCH ever sent,
  // run sat "silent" for 38+ min until the auto-reaper kicked in.
  //
  // Fix: explicitly prepend the standard Homebrew + node-global bin dirs so that
  // `claude` and `codex` are always findable regardless of inherited PATH.
  const pathExport = `export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin:$PATH"`;

  // Credential injection: agents need GH_TOKEN to clone the private repo, list
  // issues, push branches, and open PRs. Until this fix the runner exported
  // ZERO github creds, so every `gh issue list` and `git push` failed silently
  // — which (combined with the missing PATH) made every cron run PATCH-silent.
  // We export both GH_TOKEN (gh CLI) and GITHUB_TOKEN (gh CLI fallback + git).
  // We also configure git to use gh as the credential helper so `git push`
  // through HTTPS works without prompting.
  const ghTokenExport = opts.githubToken
    ? `export GH_TOKEN="${opts.githubToken}"
export GITHUB_TOKEN="${opts.githubToken}"
# Hand git the gh credential helper so git push works on private repos.
gh auth setup-git 2>&1 || echo "[runner] gh auth setup-git failed (non-fatal)"
# Dump auth status into out.log so we can verify creds plumbed through.
echo "--- gh auth status ---"
gh auth status 2>&1 || echo "[runner] gh auth status failed"
echo "--- end gh auth status ---"`
    : `echo "[runner] WARNING: no GH_TOKEN configured — gh CLI calls will fail"`;

  const anthropicExport = opts.anthropicApiKey
    ? `export ANTHROPIC_API_KEY="${opts.anthropicApiKey}"`
    : `# (no ANTHROPIC_API_KEY from Hub — relying on Mini-local config)`;

  const openaiExport = opts.openaiApiKey
    ? `export OPENAI_API_KEY="${opts.openaiApiKey}"`
    : `# (no OPENAI_API_KEY from Hub — relying on Mini-local config / codex auth.json)`;

  if (opts.provider === "codex") {
    return `#!/bin/bash
set -e
${pathExport}
${ghTokenExport}
${openaiExport}
export CODEX_HOME="${opts.workdir}/codex-home"
PROMPT=$(cat "${opts.briefingPath}")
exec codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -- "$PROMPT"
`;
  } else {
    return `#!/bin/bash
set -e
${pathExport}
${ghTokenExport}
${anthropicExport}
PROMPT=$(cat "${opts.briefingPath}")
exec claude --dangerously-skip-permissions -p "$PROMPT"
`;
  }
}

/**
 * Build the full shell command to set up a per-run workdir, write the
 * briefing + runner, inject credentials, and detach via nohup.
 *
 * Pattern copied from CC's buildRemoteCommand / buildTaskScript:
 *   - Base64-encode everything to avoid quoting hazards.
 *   - Write files via `echo <b64> | base64 -d > <path>`.
 *   - Detach with nohup ... < /dev/null > out.log 2> err.log &
 *   - Stamp PID to agent.pid.
 *   - Stamp exit code to agent.exitcode on completion.
 *   - Echo a JSON line with pid+workdir so the caller can parse it.
 */
function buildSpawnCommand(opts: {
  provider: Provider;
  mini: MiniId;
  workdir: string;
  runId: number;
  briefingB64: string;
  runnerScriptB64: string;
  codexAuthB64?: string;
  hubStatusUrl: string;
}): string {
  const { workdir } = opts;
  const logPath = `${workdir}/out.log`;
  const errPath = `${workdir}/err.log`;
  const pidPath = `${workdir}/agent.pid`;
  const briefingPath = `${workdir}/briefing.md`;
  const exitcodePath = `${workdir}/agent.exitcode`;

  const credBlock = opts.provider === "codex" && opts.codexAuthB64
    ? `
# Per-run codex credential isolation (CC auth pattern)
mkdir -p "${workdir}/codex-home"
chmod 700 "${workdir}/codex-home"
echo "${opts.codexAuthB64}" | base64 -d > "${workdir}/codex-home/auth.json"
chmod 600 "${workdir}/codex-home/auth.json"
export CODEX_HOME="${workdir}/codex-home"
`
    : "";

  // Build a wrapper script that nohup-executes the runner.
  // Using a wrapper avoids ALL quoting issues in the nohup bash -c '...' form.
  //
  // Safety-net PATCH: when the runner exits, the wrapper PATCHes the Hub run
  // record with the exit code. This guarantees the Hub gets *some* signal even
  // if the agent never wrote a single PATCH itself (because it crashed, never
  // started, ran out of credit, or just no-op'd). Before this fix, runs that
  // failed before the agent could PATCH would sit silent for 40 minutes until
  // the auto-reaper marked them stale (see runs #58-62, #73, #74).
  //
  // The wrapper's PATCH only sets status if the run is still in a non-terminal
  // state (queued/planning/running). If the agent already PATCHed status=
  // completed/failed/cancelled, our PATCH would clobber it — so we send a
  // "runner_status" payload that the Hub treats as a hint, not a forced status.
  // Implementation here uses a conditional: only set status=failed if exit!=0.
  // For exit=0 we just record the runner_exit_code in summary so the agent's
  // own PATCH (if any) wins.
  // We write the JSON payload to a file via Python json.dumps to dodge ALL
  // shell-escaping hazards (err.log can contain quotes, newlines, anything).
  // Python is universally available on macOS; if it ever isn't, the curl will
  // 400 and we'll log it but the wrapper won't crash.
  const wrapperScript = `#!/bin/bash
"${workdir}/runner.sh"
EXITCODE=$?
echo $EXITCODE > "${exitcodePath}"

# Safety-net PATCH back to the Hub so we never have a 40-minute silent run.
# Build payload via python so we don't have to escape quotes/newlines from err.log.
export EXITCODE
export ERR_TAIL=$(tail -c 800 "${errPath}" 2>/dev/null || true)
export OUT_TAIL=$(tail -c 400 "${logPath}" 2>/dev/null || true)
export HUB_MINI_VAR="${opts.mini}"
export HUB_PROVIDER_VAR="${opts.provider}"
export HUB_WORKDIR_VAR="${workdir}"

/usr/bin/python3 - <<'PYEOF' > "${workdir}/runner-payload.json" 2>> "${workdir}/runner-patch.log"
import json, os
exitcode = int(os.environ.get("EXITCODE", "-1"))
err_tail = os.environ.get("ERR_TAIL", "")
mini = os.environ.get("HUB_MINI_VAR", "unknown")
provider = os.environ.get("HUB_PROVIDER_VAR", "unknown")
workdir = os.environ.get("HUB_WORKDIR_VAR", "")
if exitcode == 0:
    payload = {
        "summary": f"runner exited with code 0 on {mini}/{provider}. Agent finished or self-terminated. See workdir for any agent-written PATCH details.",
    }
else:
    payload = {
        "status": "failed",
        "error": f"runner exited with code {exitcode}. err.log tail: {err_tail[-600:]}",
        "summary": f"runner exit {exitcode} on {mini}/{provider} — agent never reached completion (workdir: {workdir})",
        "next_pickup": f"runner-level failure on {mini}/{provider} (exit {exitcode}) — retry on a different lane and inspect {workdir}/err.log",
    }
print(json.dumps(payload))
PYEOF

curl -s -m 15 -X PATCH "${opts.hubStatusUrl}/api/fleet/runs/${opts.runId}" \\
  -H "Content-Type: application/json" \\
  --data-binary "@${workdir}/runner-payload.json" \\
  >> "${workdir}/runner-patch.log" 2>&1 \\
  || echo "[wrapper] hub PATCH curl failed exit=$?" >> "${workdir}/runner-patch.log"
`;
  const wrapperB64 = Buffer.from(wrapperScript, "utf8").toString("base64");

  return `
set -e
mkdir -p "${workdir}"
echo "${opts.briefingB64}" | base64 -d > "${briefingPath}"

export HUB_RUN_ID=${opts.runId}
export HUB_STATUS_URL="${opts.hubStatusUrl}"
export HUB_MINI="${opts.mini}"
export HUB_PROVIDER="${opts.provider}"

RUNNER="${workdir}/runner.sh"
echo "${opts.runnerScriptB64}" | base64 -d > "$RUNNER"
chmod +x "$RUNNER"
${credBlock}
# Write a clean wrapper so nohup does not have to embed shell quoting.
WRAPPER="${workdir}/nohup-wrapper.sh"
echo "${wrapperB64}" | base64 -d > "$WRAPPER"
chmod +x "$WRAPPER"

# Detach via nohup — mirrors CC's execBackground pattern exactly.
# < /dev/null disconnects stdin so the agent does not block on tty checks.
nohup "$WRAPPER" < /dev/null > "${logPath}" 2> "${errPath}" &
echo $! > "${pidPath}"
disown
sleep 1
PID=$(cat "${pidPath}")
echo "{\\"pid\\":$PID,\\"workdir\\":\\"${workdir}\\",\\"mini\\":\\"${opts.mini}\\",\\"provider\\":\\"${opts.provider}\\"}"
`.trim();
}

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

// ---------------------------------------------------------------------------
// Poll a running mini agent (reaper support)
// ---------------------------------------------------------------------------

export interface PollMiniRunResult {
  ok: boolean;
  alive: boolean;
  exited?: boolean;
  stdoutTail: string;
  stderrTail: string;
  exitSignal?: string;
  error?: string;
}

/**
 * Poll a previously-spawned agent on a Mini via CC remote-exec.
 * Returns liveness + last 4KB of stdout/stderr + exit code if done.
 *
 * Mirrors pollDirectRun() from direct-dispatch.ts.
 */
export async function pollMiniRun(opts: {
  ccApiUrl: string;
  ccApiKey: string;
  mini: MiniId;
  workdir: string;
  pid?: number;
}): Promise<PollMiniRunResult> {
  const pidCheck = opts.pid
    ? `kill -0 ${opts.pid} 2>/dev/null && echo ALIVE || echo DEAD`
    : `echo UNKNOWN`;

  const command = `
WORKDIR="${opts.workdir}"
${pidCheck}
echo "---STDOUT---"
tail -c 4096 "$WORKDIR/out.log" 2>/dev/null || true
echo ""
echo "---STDERR---"
tail -c 4096 "$WORKDIR/err.log" 2>/dev/null || true
echo ""
echo "---EXIT---"
[ -f "$WORKDIR/agent.exitcode" ] && cat "$WORKDIR/agent.exitcode" || echo "running"
`.trim();

  const res = await ccExecSync({
    ccApiUrl: opts.ccApiUrl,
    ccApiKey: opts.ccApiKey,
    agentId: opts.mini,
    command,
    timeoutMs: 15_000,
  });

  if (!res.ok) {
    return { ok: false, alive: false, stdoutTail: "", stderrTail: "", error: res.stderr };
  }

  const out = res.stdout;
  const aliveMatch = /^(ALIVE|DEAD|UNKNOWN)$/m.exec(out);
  const alive = aliveMatch?.[1] === "ALIVE";
  const exited = aliveMatch?.[1] === "DEAD";

  const stdoutMatch = /---STDOUT---\n([\s\S]*?)\n---STDERR---/m.exec(out);
  const stderrMatch = /---STDERR---\n([\s\S]*?)\n---EXIT---/m.exec(out);
  const exitMatch = /---EXIT---\n(.*)$/m.exec(out);

  return {
    ok: true,
    alive,
    exited,
    stdoutTail: stdoutMatch?.[1] ?? "",
    stderrTail: stderrMatch?.[1] ?? "",
    exitSignal: exitMatch?.[1]?.trim(),
  };
}
