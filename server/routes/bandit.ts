import type { Express } from "express";
import { dnaClient } from "../clients/dna";

export function registerBanditRoutes(app: Express) {
  // Bandit posterior state — Thompson sampling per-arm alpha/beta posteriors,
  // total decisions, and exploration ratio. Returns dna_configured=false envelope
  // when DNA_API_BASE is unset so the UI can render an empty-state.
  app.get("/api/content-platform/bandit/state", async (_req, res) => {
    const state = await dnaClient.bandit.state();
    res.json({
      dna_configured: dnaClient.configured(),
      arms: state?.arms ?? [],
      total_decisions: state?.total_decisions ?? 0,
      exploration_ratio: state?.exploration_ratio ?? null,
      computed_at: state?.computed_at ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // Bandit learning metrics — regret over 7d/30d, win rate, convergence score.
  app.get("/api/content-platform/bandit/learning-metrics", async (_req, res) => {
    const m = await dnaClient.bandit.learningMetrics();
    res.json({
      dna_configured: dnaClient.configured(),
      regret_7d: m?.regret_7d ?? null,
      regret_30d: m?.regret_30d ?? null,
      win_rate_7d: m?.win_rate_7d ?? null,
      convergence_score: m?.convergence_score ?? null,
      computed_at: m?.computed_at ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // Bandit regret time-series — cumulative regret points for sparkline rendering.
  // window_days ∈ {7,14,30}; defaults to 30.
  app.get("/api/content-platform/bandit/regret", async (req, res) => {
    const raw = parseInt(String(req.query.window_days ?? "30"), 10);
    const windowDays = [7, 14, 30].includes(raw) ? raw : 30;
    const data = await dnaClient.bandit.regret(windowDays);
    res.json({
      dna_configured: dnaClient.configured(),
      points: data?.points ?? [],
      window_days: windowDays,
      fetched_at: new Date().toISOString(),
    });
  });
}
