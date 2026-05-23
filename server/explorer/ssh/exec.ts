// CC remote-exec client + credential lease.
//
// Extracted from direct-ssh.ts (behavior-preserving modularization).
// SSH primitive ported from bemomentiq/momentiq-command-center
// commit 875218d03e19bd1f25b08050382b1558b6d1ad28 — keep in sync with that.

// ---------------------------------------------------------------------------
// CC remote-exec client
// ---------------------------------------------------------------------------

/**
 * Call CC /api/remote/exec-sync to run a command synchronously on a Mini.
 * Mirrors the shape of CC's `exec.ts` POST /exec-sync endpoint exactly.
 */
export async function ccExecSync(opts: {
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
export async function leaseCodexCredential(opts: {
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
