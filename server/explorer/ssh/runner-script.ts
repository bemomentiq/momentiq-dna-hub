// Runner script + spawn command generation.
//
// Extracted from direct-ssh.ts (behavior-preserving modularization).
// Mirrors the runner script pattern from direct-dispatch.ts, ported from CC's
// remote-script-factory.ts.

import type { MiniId, Provider } from "../direct-targets";

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
export function buildRunnerScript(opts: {
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
export function buildSpawnCommand(opts: {
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
