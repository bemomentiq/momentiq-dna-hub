import type { Express } from "express";
import { scriptsageClient } from "../clients/scriptsage";

export function registerScriptsageRoutes(app: Express) {
  // ScriptSage throughput dashboard: stats + job-health, served in one round-trip.
  // Both upstream helpers return null when SCRIPTSAGE_API_BASE is unset, so the
  // client renders an empty-state without crashing.
  app.get("/api/content-platform/scriptsage", async (_req, res) => {
    const [stats, jobsResp] = await Promise.all([
      scriptsageClient.stats(),
      scriptsageClient.jobs(),
    ]);
    res.json({
      scriptsage_configured: scriptsageClient.configured(),
      stats,
      jobs: jobsResp?.jobs ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // ScriptSage generation failures — proxies upstream monitoring endpoint.
  app.get("/api/content-platform/scriptsage/failures", async (_req, res) => {
    const configured = scriptsageClient.configured();
    const data = await scriptsageClient.failures();
    if (configured && data === null) {
      return void res.status(502).json({
        scriptsage_configured: true,
        upstream_error: true,
        failures: [],
        fetched_at: new Date().toISOString(),
      });
    }
    res.json({
      scriptsage_configured: configured,
      upstream_error: false,
      failures: data?.failures ?? [],
      fetched_at: new Date().toISOString(),
    });
  });

  // ScriptSage error signatures by window (7|14|30 days, default 7).
  app.get("/api/content-platform/scriptsage/errors", async (req, res) => {
    const raw = parseInt(String(req.query.window_days ?? "7"), 10);
    const windowDays = [7, 14, 30].includes(raw) ? raw : 7;
    const configured = scriptsageClient.configured();
    const data = await scriptsageClient.errors(windowDays);
    if (configured && data === null) {
      return void res.status(502).json({
        scriptsage_configured: true,
        upstream_error: true,
        signatures: [],
        window_days: windowDays,
        fetched_at: new Date().toISOString(),
      });
    }
    res.json({
      scriptsage_configured: configured,
      upstream_error: false,
      signatures: data?.signatures ?? [],
      window_days: windowDays,
      fetched_at: new Date().toISOString(),
    });
  });

  // ScriptSage job queue health snapshot.
  app.get("/api/content-platform/scriptsage/queue-health", async (_req, res) => {
    const data = await scriptsageClient.queueHealth();
    res.json({
      scriptsage_configured: scriptsageClient.configured(),
      queue: data,
      fetched_at: new Date().toISOString(),
    });
  });

  // ScriptSage pipeline funnel by window (7|14|30 days, default 7).
  app.get("/api/content-platform/scriptsage/funnel", async (req, res) => {
    const raw = parseInt(String(req.query.window_days ?? "7"), 10);
    const windowDays = [7, 14, 30].includes(raw) ? raw : 7;
    const configured = scriptsageClient.configured();
    const data = await scriptsageClient.funnels(windowDays);
    if (configured && data === null) {
      return void res.status(502).json({
        scriptsage_configured: true,
        upstream_error: true,
        funnels: [],
        window_days: windowDays,
        fetched_at: new Date().toISOString(),
      });
    }
    res.json({
      scriptsage_configured: configured,
      upstream_error: false,
      funnels: data?.funnels ?? [],
      window_days: windowDays,
      fetched_at: new Date().toISOString(),
    });
  });
}
