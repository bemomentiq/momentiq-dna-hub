import type { Express } from "express";
import { storage } from "../storage";
import { dnaClient } from "../clients/dna";
import { scriptsageClient } from "../clients/scriptsage";
import { checkDnaHealth, checkScriptsageHealth, checkKalodataHealth } from "../clients/health";
import { cacheStats, cacheBust } from "../clients/cache";

export function registerContentPlatformRoutes(app: Express) {
  // Content-platform overview: aggregates dna corpus + A/B activity + ScriptSage
  // throughput + subscriptions + open issues across the 4 content repos.
  // Each upstream call returns null when its base URL env var is unset, so the
  // endpoint never crashes — clients render empty-states per section.
  app.get("/api/content-platform/overview", async (_req, res) => {
    const [corpus, abRuns, veo, ids, ssStats, ssSubs] = await Promise.all([
      dnaClient.corpus(),
      dnaClient.abRuns({ status: "running", limit: 50 }),
      dnaClient.veoCost(7),
      dnaClient.idsDistribution(7),
      scriptsageClient.stats(),
      scriptsageClient.subscriptions(),
    ]);
    const overall = ids?.distributions.find((d) => d.dimension === "overall") ?? null;
    res.json({
      dna_configured: dnaClient.configured(),
      scriptsage_configured: scriptsageClient.configured(),
      corpus,
      ab_runs_active: abRuns?.runs.length ?? null,
      ids_median_7d: overall?.median ?? null,
      veo_spend_7d_usd: veo?.total_cost_usd ?? null,
      veo_themes_7d: veo?.summary ?? null,
      scriptsage: ssStats,
      subscriptions: ssSubs,
      fetched_at: new Date().toISOString(),
    });
  });

  // Themes & Champions: proxies dnaClient.themes() with dna_configured flag so
  // the client can render an empty-state when DNA_API_BASE is unset.
  app.get("/api/content-platform/themes", async (_req, res) => {
    const result = await dnaClient.themes();
    res.json({
      themes: result?.themes ?? [],
      dna_configured: dnaClient.configured(),
    });
  });

  // Veo cost & ROI by theme — proxies dnaClient.veoCost. Returns
  // { dna_configured, summary, total_cost_usd, window_days }. When dna is not
  // configured (DNA_API_BASE unset) the upstream returns null and we surface
  // an empty payload so the page can render its empty-state.
  app.get("/api/content-platform/veo-cost", async (req, res) => {
    const raw = parseInt(String(req.query.window_days ?? "7"), 10);
    const windowDays = [7, 14, 30].includes(raw) ? raw : 7;
    const configured = dnaClient.configured();
    const upstream = await dnaClient.veoCost(windowDays);
    // When DNA is configured but veoCost returns null, that's an upstream
    // failure (network/5xx) — surface it as 502 with upstream_error so the
    // client can render a distinct error state instead of collapsing to
    // "no Veo calls". Bugbot flagged this on PR #19.
    if (configured && upstream === null) {
      return void res.status(502).json({
        dna_configured: true,
        upstream_error: true,
        summary: [],
        total_cost_usd: 0,
        window_days: windowDays,
      });
    }
    res.json({
      dna_configured: configured,
      upstream_error: false,
      summary: upstream?.summary ?? [],
      total_cost_usd: upstream?.total_cost_usd ?? 0,
      window_days: upstream?.window_days ?? windowDays,
    });
  });

  // Per-theme drill-down: champion config + variants (A/B runs).
  // Returns { dna_configured, theme, variants } so the client can render an
  // empty-state when DNA_API_BASE is unset, instead of 502'ing.
  app.get("/api/content-platform/themes/:slug", async (req, res) => {
    const data = await dnaClient.theme(req.params.slug);
    res.json({
      dna_configured: dnaClient.configured(),
      slug: req.params.slug,
      theme: data?.theme ?? null,
      variants: data?.variants ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // Subscriptions & credit burn — proxies ScriptSage. Returns empty payload
  // (subscriptions: null) when the upstream is unconfigured so the page renders
  // a graceful empty state.
  app.get("/api/content-platform/subscriptions", async (_req, res) => {
    const subs = await scriptsageClient.subscriptions();
    res.json({
      scriptsage_configured: scriptsageClient.configured(),
      subscriptions: subs,
      fetched_at: new Date().toISOString(),
    });
  });

  // A/B runs proxy: forwards optional status / limit filters to dnaClient and
  // returns null payload when DNA_API_BASE is unset so the UI can render an
  // empty-state instead of erroring.
  app.get("/api/content-platform/ab-runs", async (req, res) => {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const data = await dnaClient.abRuns({
      status,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    res.json({
      dna_configured: dnaClient.configured(),
      runs: data?.runs ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // IDS distribution proxy: 5-dimension scorecard + overall composite. Returns
  // dna_configured=false when DNA_API_BASE is unset so the client can render an
  // empty-state instead of crashing.
  app.get("/api/content-platform/ids-distribution", async (req, res) => {
    const windowDaysRaw = parseInt(String(req.query.window_days ?? "7"), 10);
    const windowDays = Number.isFinite(windowDaysRaw) && windowDaysRaw > 0 ? windowDaysRaw : 7;
    const ids = await dnaClient.idsDistribution(windowDays);
    res.json({
      dna_configured: dnaClient.configured(),
      distributions: ids?.distributions ?? null,
      window_days: ids?.window_days ?? windowDays,
      fetched_at: new Date().toISOString(),
    });
  });

  // Promotion candidates: completed A/B runs whose champion clears the
  // promotion gate (IDS >= 0.85 AND delta_vs_control >= 0.10). Returns [] when
  // the dna service is unreachable so the executive brief renders an empty
  // state rather than erroring out.
  app.get("/api/content-platform/promotion-candidates", async (_req, res) => {
    const data = await dnaClient.abRuns({ status: "completed", limit: 50 });
    const runs = data?.runs ?? [];
    const candidates = runs.filter(
      (r) => (r.ids_mean ?? 0) >= 0.85 && (r.delta_vs_control ?? 0) >= 0.1
    );
    res.json({
      dna_configured: dnaClient.configured(),
      candidates,
      fetched_at: new Date().toISOString(),
    });
  });

  // Reachability probes for upstream content-platform services. Bypasses the
  // read cache — sidebar pill / monitors should see live status.
  app.get("/api/content-platform/health", async (_req, res) => {
    const cfg = storage.getCronConfig() as any;
    const companionUrl = cfg.companion_site_url || process.env.KALODATA_API_URL || "";
    const [dna, ss, kalo] = await Promise.all([
      checkDnaHealth(),
      checkScriptsageHealth(),
      companionUrl ? checkKalodataHealth(companionUrl) : Promise.resolve({
        configured: false,
        reachable: null,
        latency_ms: null,
        checked_at: new Date().toISOString(),
        error: null,
      }),
    ]);
    res.json({ dna, scriptsage: ss, kalodata: kalo, fetched_at: new Date().toISOString() });
  });

  // Cache introspection + bust (ops-only; useful from the autonomy page).
  app.get("/api/content-platform/cache", (_req, res) => {
    res.json(cacheStats());
  });
  app.post("/api/content-platform/cache/bust", (req, res) => {
    const prefix = (req.query.prefix as string) || undefined;
    const n = cacheBust(prefix);
    res.json({ busted: n, prefix: prefix ?? "(all)" });
  });
}
