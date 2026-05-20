// Typed fetch wrapper for the momentiq-dna service.
// Base URL is read from DNA_API_BASE; when unset, helpers return null so callers
// can render empty-states instead of crashing in environments without access.

const BASE = process.env.DNA_API_BASE || "";
const TOKEN = process.env.DNA_API_TOKEN || "";

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
  return BASE.length > 0;
}

async function dnaGet<T>(path: string): Promise<T | null> {
  if (!BASE) return null;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  try {
    const r = await fetch(`${BASE.replace(/\/$/, "")}${path}`, { headers });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const dnaClient = {
  configured: dnaConfigured,
  themes: () => dnaGet<{ themes: ThemeOptimalConfig[] }>("/api/dna/themes"),
  theme: (slug: string) =>
    dnaGet<{ theme: ThemeOptimalConfig; variants: AbRun[] }>(`/api/dna/themes/${encodeURIComponent(slug)}`),
  abRuns: (opts: { status?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.status) q.set("status", opts.status);
    if (opts.limit) q.set("limit", String(opts.limit));
    return dnaGet<{ runs: AbRun[] }>(`/api/dna/ab-runs?${q}`);
  },
  veoCost: (windowDays: number = 7) =>
    dnaGet<{ summary: VeoCallSummary[]; total_cost_usd: number; window_days: number }>(
      `/api/dna/veo-cost?window_days=${windowDays}`
    ),
  idsDistribution: (windowDays: number = 7) =>
    dnaGet<{ distributions: IdsDistribution[]; window_days: number }>(
      `/api/dna/ids-distribution?window_days=${windowDays}`
    ),
  corpus: () => dnaGet<CorpusStats>("/api/dna/corpus-stats"),
};
