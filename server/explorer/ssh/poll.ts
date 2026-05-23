// pollMiniRun — poll a running Mini agent (reaper support).
//
// Extracted from direct-ssh.ts (behavior-preserving modularization).

import type { MiniId } from "../direct-targets";
import { ccExecSync } from "./exec";

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
