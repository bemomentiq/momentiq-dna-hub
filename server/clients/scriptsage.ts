// Typed fetch wrapper for the scriptsage-backend service.
// Base URL is read from SCRIPTSAGE_API_BASE; when unset, helpers return null
// so callers render empty-states instead of crashing.

import { cached } from "./cache";
import { storage } from "../storage";

function getBase(): string {
  if (process.env.SCRIPTSAGE_API_BASE) return process.env.SCRIPTSAGE_API_BASE;
  try {
    return (storage.getCronConfigSafe() as any)?.scriptsage_api_base || "";
  } catch {
    return "";
  }
}
function getToken(): string {
  if (process.env.SCRIPTSAGE_API_TOKEN) return process.env.SCRIPTSAGE_API_TOKEN;
  try {
    return (storage.getCronConfigSafe() as any)?.scriptsage_api_token || "";
  } catch {
    return "";
  }
}

export type ScriptSageStats = {
  scripts_generated_24h: number;
  scripts_generated_7d: number;
  videos_generated_24h: number;
  videos_generated_7d: number;
  fallback_rate_24h: number;
  error_rate_24h: number;
  status_sync_lag_seconds: number;
};

export type SubscriptionStats = {
  active_users: number;
  mrr_usd: number;
  tier_mix: { tier: string; count: number; mrr_usd: number }[];
  top_users_by_credit_burn: { user_id: string; email: string | null; credits_30d: number }[];
};

export type JobStatus = {
  job: string;
  last_run_at: string | null;
  last_status: "ok" | "error" | "stalled" | "unknown";
  last_error: string | null;
};

export function scriptsageConfigured(): boolean {
  return getBase().length > 0;
}

async function ssGet<T>(path: string): Promise<T | null> {
  const base = getBase();
  if (!base) return null;
  const token = getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const r = await fetch(`${base.replace(/\/$/, "")}${path}`, { headers });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const scriptsageClient = {
  configured: scriptsageConfigured,
  stats: () => cached("ss:stats", 30_000, () => ssGet<ScriptSageStats>("/api/admin/stats")),
  subscriptions: () =>
    cached("ss:subs", 60_000, () => ssGet<SubscriptionStats>("/api/admin/subscriptions")),
  jobs: () => cached("ss:jobs", 30_000, () => ssGet<{ jobs: JobStatus[] }>("/api/admin/jobs")),
};
