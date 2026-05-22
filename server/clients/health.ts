// Lightweight reachability probes for upstream content-platform services.
// Bypasses the read cache — health should always be live.

import { storage } from "../storage";

function dnaBase(): string {
  if (process.env.DNA_API_BASE) return process.env.DNA_API_BASE;
  try { return (storage.getCronConfigSafe() as any)?.dna_api_base || ""; } catch { return ""; }
}
function dnaToken(): string | null {
  if (process.env.DNA_API_TOKEN) return process.env.DNA_API_TOKEN;
  try { return (storage.getCronConfigSafe() as any)?.dna_api_token || null; } catch { return null; }
}
function ssBase(): string {
  if (process.env.SCRIPTSAGE_API_BASE) return process.env.SCRIPTSAGE_API_BASE;
  try { return (storage.getCronConfigSafe() as any)?.scriptsage_api_base || ""; } catch { return ""; }
}
function ssToken(): string | null {
  if (process.env.SCRIPTSAGE_API_TOKEN) return process.env.SCRIPTSAGE_API_TOKEN;
  try { return (storage.getCronConfigSafe() as any)?.scriptsage_api_token || null; } catch { return null; }
}

type ServiceHealth = {
  configured: boolean;
  reachable: boolean | null;
  latency_ms: number | null;
  checked_at: string;
  error: string | null;
};

const TIMEOUT_MS = 3000;

async function probe(base: string, path: string, token: string | null): Promise<ServiceHealth> {
  if (!base) {
    return {
      configured: false,
      reachable: null,
      latency_ms: null,
      checked_at: new Date().toISOString(),
      error: null,
    };
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}${path}`, { headers, signal: ctl.signal });
    const dt = Date.now() - t0;
    return {
      configured: true,
      reachable: r.ok,
      latency_ms: dt,
      checked_at: new Date().toISOString(),
      error: r.ok ? null : `HTTP ${r.status}`,
    };
  } catch (err: any) {
    return {
      configured: true,
      reachable: false,
      latency_ms: null,
      checked_at: new Date().toISOString(),
      error: err?.name === "AbortError" ? "timeout" : (err?.message ?? String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkDnaHealth(): Promise<ServiceHealth> {
  return probe(dnaBase(), "/api/health", dnaToken());
}

export async function checkScriptsageHealth(): Promise<ServiceHealth> {
  return probe(ssBase(), "/api/admin/health", ssToken());
}

export async function checkKalodataHealth(companionUrl: string): Promise<ServiceHealth> {
  return probe(companionUrl, "/api/readiness", null);
}
