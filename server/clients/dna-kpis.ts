// DNA KPI aggregator for the Overview + ExecutiveBrief pages.
//
// Pulls the DNA-actual KPIs (IDS convergence, bandit M11 progress, video
// win-rate, GMV Max ROAS, 24h volume, IDS-passing volume, outbound usage)
// from a mix of the dnaClient REST surface and an optional read-only Neon
// role (DNA_NEON_READ_URL) against momentiq-dna's database. Every source
// degrades to null on its own — the endpoint never crashes.
//
// All values are wrapped in a 5-minute in-process TTL cache to keep load on
// the upstream DNA service bounded.

import { Client } from "pg";
import { cached } from "./cache";
import { dnaClient, dnaConfigured } from "./dna";

const IDS_TARGET = 0.85;
const CACHE_KEY = "overview:dna-kpis";
const CACHE_TTL_MS = 5 * 60 * 1000;

export type DnaKpiSnapshot = {
  ids_convergence_pct: number | null;
  bandit_m11_progress: number | null;
  video_win_rate_24h: number | null;
  gmv_max_roas_7d: number | null;
  videos_24h: number | null;
  videos_ids_pass_24h: number | null;
  outbound_used_24h: number | null;
};

export type DnaKpiRecentRun = {
  run_id: string;
  theme: string;
  status: string;
  ids_mean: number | null;
  started_at: string;
};

export type DnaKpis = DnaKpiSnapshot & {
  dna_configured: boolean;
  neon_available: boolean;
  ids_target: number;
  prior_7d: DnaKpiSnapshot | null;
  recent_runs: DnaKpiRecentRun[];
  fetched_at: string;
};

function pctTowardTarget(value: number | null | undefined, target: number): number | null {
  if (value == null || !Number.isFinite(value) || target <= 0) return null;
  return Math.max(0, Math.min(100, (value / target) * 100));
}

function pctOf(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value * 100));
}

// Optional Neon read — returns null and a reason if NEON env var is not set
// or the query fails. We keep a short timeout so a slow Neon never stalls
// the entire dashboard load.
type NeonKpiRow = {
  videos_24h: number | null;
  videos_ids_pass_24h: number | null;
  outbound_used_24h: number | null;
  gmv_max_roas_7d: number | null;
  gmv_max_roas_prior_7d: number | null;
  videos_prior_24h: number | null;
  videos_ids_pass_prior_24h: number | null;
  outbound_used_prior_24h: number | null;
};

async function fetchNeonKpis(): Promise<NeonKpiRow | null> {
  const connStr = process.env.DNA_NEON_READ_URL;
  if (!connStr) return null;
  const client = new Client({
    connectionString: connStr,
    statement_timeout: 4000,
    query_timeout: 4000,
  });
  try {
    await client.connect();
    // Tables expected on the momentiq-dna side per the DNA-1 spec:
    //   ids_runs(created_at, ids_overall_score)
    //   bandit_arms (state, unused here)
    //   apo_champions (outbound_used_at)
    //   gmv_max_metrics(date, spend_usd, attributed_gmv_usd)
    // The query is intentionally tolerant — if any table is missing the
    // outer catch returns null and the endpoint falls back to dnaClient.
    const res = await client.query<{
      videos_24h: string | null;
      videos_ids_pass_24h: string | null;
      videos_prior_24h: string | null;
      videos_ids_pass_prior_24h: string | null;
      outbound_used_24h: string | null;
      outbound_used_prior_24h: string | null;
      gmv_max_roas_7d: string | null;
      gmv_max_roas_prior_7d: string | null;
    }>(`
      WITH ids_now AS (
        SELECT
          COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE ids_overall_score >= ${IDS_TARGET})::int AS n_pass
        FROM ids_runs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      ),
      ids_prior AS (
        SELECT
          COUNT(*)::int AS n,
          COUNT(*) FILTER (WHERE ids_overall_score >= ${IDS_TARGET})::int AS n_pass
        FROM ids_runs
        WHERE created_at >= NOW() - INTERVAL '48 hours'
          AND created_at <  NOW() - INTERVAL '24 hours'
      ),
      outbound_now AS (
        SELECT COUNT(*)::int AS n
        FROM apo_champions
        WHERE outbound_used_at >= NOW() - INTERVAL '24 hours'
      ),
      outbound_prior AS (
        SELECT COUNT(*)::int AS n
        FROM apo_champions
        WHERE outbound_used_at >= NOW() - INTERVAL '48 hours'
          AND outbound_used_at <  NOW() - INTERVAL '24 hours'
      ),
      gmv_now AS (
        SELECT
          NULLIF(SUM(spend_usd), 0) AS spend,
          SUM(attributed_gmv_usd) AS gmv
        FROM gmv_max_metrics
        WHERE date >= (CURRENT_DATE - INTERVAL '7 days')::date
      ),
      gmv_prior AS (
        SELECT
          NULLIF(SUM(spend_usd), 0) AS spend,
          SUM(attributed_gmv_usd) AS gmv
        FROM gmv_max_metrics
        WHERE date >= (CURRENT_DATE - INTERVAL '14 days')::date
          AND date <  (CURRENT_DATE - INTERVAL '7 days')::date
      )
      SELECT
        (SELECT n FROM ids_now)::text         AS videos_24h,
        (SELECT n_pass FROM ids_now)::text    AS videos_ids_pass_24h,
        (SELECT n FROM ids_prior)::text       AS videos_prior_24h,
        (SELECT n_pass FROM ids_prior)::text  AS videos_ids_pass_prior_24h,
        (SELECT n FROM outbound_now)::text    AS outbound_used_24h,
        (SELECT n FROM outbound_prior)::text  AS outbound_used_prior_24h,
        ((SELECT gmv FROM gmv_now) / (SELECT spend FROM gmv_now))::text       AS gmv_max_roas_7d,
        ((SELECT gmv FROM gmv_prior) / (SELECT spend FROM gmv_prior))::text   AS gmv_max_roas_prior_7d
    `);
    const row = res.rows[0];
    if (!row) return null;
    const num = (s: string | null) => (s == null ? null : Number(s));
    return {
      videos_24h: num(row.videos_24h),
      videos_ids_pass_24h: num(row.videos_ids_pass_24h),
      videos_prior_24h: num(row.videos_prior_24h),
      videos_ids_pass_prior_24h: num(row.videos_ids_pass_prior_24h),
      outbound_used_24h: num(row.outbound_used_24h),
      outbound_used_prior_24h: num(row.outbound_used_prior_24h),
      gmv_max_roas_7d: num(row.gmv_max_roas_7d),
      gmv_max_roas_prior_7d: num(row.gmv_max_roas_prior_7d),
    };
  } catch {
    return null;
  } finally {
    try {
      await client.end();
    } catch {
      // ignore
    }
  }
}

async function buildSnapshot(): Promise<DnaKpis> {
  const configured = dnaConfigured();
  const [ids7, ids14, bandit, abRunsResp, neon] = await Promise.all([
    dnaClient.idsDistribution(7),
    dnaClient.idsDistribution(14),
    dnaClient.bandit.learningMetrics(),
    dnaClient.abRuns({ status: "running", limit: 5 }),
    fetchNeonKpis(),
  ]);

  const overall7 = ids7?.distributions.find((d) => d.dimension === "overall") ?? null;
  const overall14 = ids14?.distributions.find((d) => d.dimension === "overall") ?? null;
  // Prior 7d IDS isn't directly derivable from the 14-day median; we use the
  // 14-day median as the prior baseline reference, which is a reasonable
  // smoothing proxy until momentiq-dna exposes a windowed series.
  const priorIdsMedian =
    overall14 && overall7
      ? // If we had counts, we could back-solve; lacking that, fall back to
        // the wider window median as the comparison baseline.
        overall14.median
      : null;

  const snapshot: DnaKpiSnapshot = {
    ids_convergence_pct: pctTowardTarget(overall7?.median, IDS_TARGET),
    bandit_m11_progress: pctOf(bandit?.convergence_score),
    video_win_rate_24h: bandit?.win_rate_7d ?? null,
    gmv_max_roas_7d: neon?.gmv_max_roas_7d ?? null,
    videos_24h: neon?.videos_24h ?? null,
    videos_ids_pass_24h: neon?.videos_ids_pass_24h ?? null,
    outbound_used_24h: neon?.outbound_used_24h ?? null,
  };

  // Build a prior-window snapshot for the WoW delta. Only fields with a
  // genuine prior data point are populated; the rest stay null and the
  // client renders "—".
  const prior: DnaKpiSnapshot = {
    ids_convergence_pct: pctTowardTarget(priorIdsMedian, IDS_TARGET),
    bandit_m11_progress: null,
    video_win_rate_24h: null,
    gmv_max_roas_7d: neon?.gmv_max_roas_prior_7d ?? null,
    videos_24h: neon?.videos_prior_24h ?? null,
    videos_ids_pass_24h: neon?.videos_ids_pass_prior_24h ?? null,
    outbound_used_24h: neon?.outbound_used_prior_24h ?? null,
  };

  const recent_runs: DnaKpiRecentRun[] = (abRunsResp?.runs ?? [])
    .slice(0, 5)
    .map((r) => ({
      run_id: r.run_id,
      theme: r.theme,
      status: r.status,
      ids_mean: r.ids_mean ?? null,
      started_at: r.started_at,
    }));

  // A prior snapshot with no signal at all is more honestly reported as
  // null so the client can hide the delta strip entirely.
  const priorHasSignal =
    prior.ids_convergence_pct != null ||
    prior.gmv_max_roas_7d != null ||
    prior.videos_24h != null ||
    prior.videos_ids_pass_24h != null ||
    prior.outbound_used_24h != null;

  return {
    ...snapshot,
    dna_configured: configured,
    neon_available: neon != null,
    ids_target: IDS_TARGET,
    prior_7d: priorHasSignal ? prior : null,
    recent_runs,
    fetched_at: new Date().toISOString(),
  };
}

export function getDnaKpis(): Promise<DnaKpis> {
  return cached(CACHE_KEY, CACHE_TTL_MS, buildSnapshot);
}
