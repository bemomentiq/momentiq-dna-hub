/**
 * neon-signals.ts
 * Fetches live SID production signals from Neon Postgres for injection into
 * the Explorer prompt.  Uses a 10-minute in-memory cache so we never hammer
 * the DB more than once per Explorer run cycle.
 */

import { Client } from "pg";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionSignal {
  action_name: string;
  run_count: number;
  pass_rate: number; // 0-1
}

export interface QueueDepthRow {
  status: string;
  count: number;
}

export interface LiveSignals {
  topActions: ActionSignal[];
  queueDepth: QueueDepthRow[];
  hitlHours7d: number;
  fetchedAt: string;
}

export interface SignalsResult {
  available: true;
  data: LiveSignals;
}

export interface SignalsUnavailable {
  available: false;
  reason: string;
}

export type FetchSignalsResult = SignalsResult | SignalsUnavailable;

// ---------------------------------------------------------------------------
// 10-minute in-memory cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

let cachedResult: FetchSignalsResult | null = null;
let cacheTimestamp = 0;

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

export async function fetchLiveSignals(): Promise<FetchSignalsResult> {
  // Graceful fallback when env var is missing
  const connStr = process.env.NEON_READ_URL;
  if (!connStr) {
    return { available: false, reason: "NEON_READ_URL not set" };
  }

  // Return cached value if still fresh
  const now = Date.now();
  if (cachedResult && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedResult;
  }

  const client = new Client({ connectionString: connStr });

  try {
    await client.connect();

    // --- 1. cos_runs: top actions grouped by action_name in last 24h ---
    const actionsRes = await client.query<{
      action_name: string;
      run_count: string;
      pass_rate: string;
    }>(`
      SELECT
        action_name,
        COUNT(*)::int                                                   AS run_count,
        ROUND(
          AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END)::numeric,
          4
        )                                                               AS pass_rate
      FROM cos_runs
      WHERE started_at >= NOW() - INTERVAL '24 hours'
      GROUP BY action_name
      ORDER BY run_count DESC
      LIMIT 20
    `);

    const topActions: ActionSignal[] = actionsRes.rows.map((r) => ({
      action_name: r.action_name,
      run_count: Number(r.run_count),
      pass_rate: Number(r.pass_rate),
    }));

    // --- 2. cos_run_queue: current depth by status ---
    const queueRes = await client.query<{ status: string; count: string }>(`
      SELECT status, COUNT(*)::int AS count
      FROM cos_run_queue
      GROUP BY status
      ORDER BY count DESC
    `);

    const queueDepth: QueueDepthRow[] = queueRes.rows.map((r) => ({
      status: r.status,
      count: Number(r.count),
    }));

    // --- 3. hitl_decision_log: total HITL hours over last 7 days ---
    const hitlRes = await client.query<{ total_minutes: string }>(`
      SELECT COALESCE(SUM(duration_minutes), 0)::numeric AS total_minutes
      FROM hitl_decision_log
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `);

    const hitlHours7d = Number(hitlRes.rows[0]?.total_minutes ?? 0) / 60;

    const data: LiveSignals = {
      topActions,
      queueDepth,
      hitlHours7d: Math.round(hitlHours7d * 10) / 10,
      fetchedAt: new Date().toISOString(),
    };

    cachedResult = { available: true, data };
    cacheTimestamp = now;
    return cachedResult;
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    return { available: false, reason: `Neon query failed: ${reason}` };
  } finally {
    try {
      await client.end();
    } catch {
      // ignore disconnect errors
    }
  }
}

/** Expose cache age in seconds — useful for diagnostics. */
export function signalsCacheAgeSeconds(): number {
  return cacheTimestamp ? Math.round((Date.now() - cacheTimestamp) / 1000) : -1;
}
