// Typed fetch wrapper for the momentiq-dna service.
// Base URL is read from DNA_API_BASE; when unset, helpers return null so callers
// can render empty-states instead of crashing in environments without access.

import { cached } from "./cache";
import { storage } from "../storage";

// Resolve base + token at request time, env first then cron_config DB row.
// This lets operators edit URLs from the autonomy page without redeploys.
function getBase(): string {
  if (process.env.DNA_API_BASE) return process.env.DNA_API_BASE;
  try {
    return (storage.getCronConfigSafe() as any)?.dna_api_base || "";
  } catch {
    return "";
  }
}
function getToken(): string {
  if (process.env.DNA_API_TOKEN) return process.env.DNA_API_TOKEN;
  try {
    return (storage.getCronConfigSafe() as any)?.dna_api_token || "";
  } catch {
    return "";
  }
}

export type ThemeOptimalConfig = {
  theme: string;
  champion_config_id: string | null;
  ids_median: number | null;
  delta_vs_control: number | null;
  promoted_at: string | null;
  thompson_alpha: number | null;
  thompson_beta: number | null;
};

export type AbRun = {
  run_id: string;
  theme: string;
  status: "running" | "completed" | "promoted" | "rejected";
  videos_scored: number;
  videos_budget: number;
  ids_mean: number | null;
  delta_vs_control: number | null;
  veo_cost_usd: number | null;
  roi_usd: number | null;
  started_at: string;
  completed_at: string | null;
};

export type VeoCallSummary = {
  theme: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_per_video: number;
  winning_videos: number;
  cost_per_winner: number | null;
};

export type IdsDistribution = {
  dimension: "naturalness" | "fidelity" | "commerce" | "diversity" | "safety" | "overall";
  median: number;
  p25: number;
  p75: number;
  n: number;
};

export type CorpusStats = {
  videos: number;
  gmv_usd: number;
  last_harvest_at: string | null;
};

export function dnaConfigured(): boolean {
  return getBase().length > 0;
}

async function dnaGet<T>(path: string): Promise<T | null> {
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

// All read helpers go through a 30–60s TTL cache so the hub doesn't hammer
// momentiq-dna on every page render. Mutations should bust cache via cacheBust.
export const dnaClient = {
  configured: dnaConfigured,
  themes: () =>
    cached("dna:themes", 60_000, () =>
      dnaGet<{ themes: ThemeOptimalConfig[] }>("/api/dna/themes"),
    ),
  theme: (slug: string) =>
    cached(`dna:theme:${slug}`, 60_000, () =>
      dnaGet<{ theme: ThemeOptimalConfig; variants: AbRun[] }>(
        `/api/dna/themes/${encodeURIComponent(slug)}`,
      ),
    ),
  abRuns: (opts: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.status) q.set("status", opts.status);
    if (opts.limit) q.set("limit", String(opts.limit));
    return cached(`dna:abRuns:${q}`, 30_000, () =>
      dnaGet<{ runs: AbRun[] }>(`/api/dna/ab-runs?${q}`),
    );
  },
  veoCost: (windowDays: number = 7) =>
    cached(`dna:veoCost:${windowDays}`, 30_000, () =>
      dnaGet<{ summary: VeoCallSummary[]; total_cost_usd: number; window_days: number }>(
        `/api/dna/veo-cost?window_days=${windowDays}`,
      ),
    ),
  idsDistribution: (windowDays: number = 7) =>
    cached(`dna:ids:${windowDays}`, 30_000, () =>
      dnaGet<{ distributions: IdsDistribution[]; window_days: number }>(
        `/api/dna/ids-distribution?window_days=${windowDays}`,
      ),
    ),
  corpus: () =>
    cached("dna:corpus", 60_000, () => dnaGet<CorpusStats>("/api/dna/corpus-stats")),
};
