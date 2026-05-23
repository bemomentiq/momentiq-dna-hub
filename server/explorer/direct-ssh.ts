// SSH-via-CC spawn primitive for Autonomy Hub direct-dispatch.
//
// SSH primitive ported from bemomentiq/momentiq-command-center
// commit 875218d03e19bd1f25b08050382b1558b6d1ad28 — keep in sync with that.
//
// This file is now a thin barrel re-exporting the modules under ./ssh/.
// The implementation was split into:
//   ssh/exec.ts          — ccExecSync, leaseCodexCredential
//   ssh/runner-script.ts — buildRunnerScript, buildSpawnCommand
//   ssh/spawn.ts         — spawnOnMini (+ opts/result types)
//   ssh/poll.ts          — pollMiniRun (+ result type)

export { spawnOnMini } from "./ssh/spawn";
export type { SpawnOnMiniOpts, SpawnOnMiniResult } from "./ssh/spawn";
export { pollMiniRun } from "./ssh/poll";
export type { PollMiniRunResult } from "./ssh/poll";
