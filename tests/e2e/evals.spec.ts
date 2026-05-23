import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// The hub's "evals" surface is split across two routes:
//   * /ab-runs — A/B experiment outcomes (the legacy /evals URL redirects here)
//   * /pipeline-health — has the actual SVG heatmap (failure pivot)
// We cover both so the issue's "heatmap renders" assertion can't silently
// regress whichever surface owns it next.

test("ab-runs page renders A/B experiments shell", async ({ page }) => {
  const watcher = watchConsole(page);
  await page.route("**/api/content-platform/ab-runs**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        dna_configured: true,
        runs: [
          {
            run_id: "abr_demo_1",
            theme: "demo-theme",
            status: "running",
            videos_scored: 12,
            videos_budget: 40,
            ids_mean: 0.78,
            delta_vs_control: 0.04,
            veo_cost_usd: 12.5,
            roi_usd: 30.0,
            started_at: new Date().toISOString(),
            completed_at: null,
          },
        ],
        fetched_at: new Date().toISOString(),
      }),
    }),
  );

  await gotoHash(page, "/ab-runs");
  // Tab strip is the page's defining widget.
  for (const tab of ["Running", "Completed", "Promoted", "Rejected"]) {
    await expect(page.getByRole("tab", { name: tab })).toBeVisible();
  }
  await expectNoConsoleErrors(watcher);
});

test("pipeline-health renders the SVG heatmap when failures exist", async ({ page }) => {
  const watcher = watchConsole(page);

  await page.route("**/api/content-platform/scriptsage/queue-health", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scriptsage_configured: true,
        queue: {
          pending: 0,
          processing: 0,
          p50_latency_ms: 100,
          p95_latency_ms: 500,
          stalled_count: 0,
          computed_at: new Date().toISOString(),
        },
      }),
    }),
  );
  await page.route("**/api/content-platform/scriptsage/failures", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scriptsage_configured: true,
        failures: [
          {
            pipeline: "scriptsage",
            category: "tiktok_shop",
            error_signature: "TimeoutError",
            count_24h: 3,
            count_7d: 8,
            last_seen_at: new Date().toISOString(),
          },
          {
            pipeline: "vidgen",
            category: "tiktok_shop",
            error_signature: "RateLimit",
            count_24h: 1,
            count_7d: 4,
            last_seen_at: new Date().toISOString(),
          },
        ],
      }),
    }),
  );
  await page.route("**/api/content-platform/scriptsage/errors**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ scriptsage_configured: true, signatures: [], window_days: 7 }),
    }),
  );
  await page.route("**/api/content-platform/scriptsage/funnel**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ scriptsage_configured: true, funnels: [], window_days: 7 }),
    }),
  );

  await gotoHash(page, "/pipeline-health");
  await expect(page.getByTestId("heatmap")).toBeVisible();
  await expectNoConsoleErrors(watcher);
});

test("scoring page renders 5-dimension IDS grid (sibling evals surface)", async ({ page }) => {
  const watcher = watchConsole(page);
  await page.route("**/api/content-platform/ids-distribution**", (r) =>
    r.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        dna_configured: true,
        window_days: 7,
        fetched_at: new Date().toISOString(),
        distributions: [
          { dimension: "overall", median: 0.88, p25: 0.8, p75: 0.93, n: 100 },
          { dimension: "naturalness", median: 0.9, p25: 0.82, p75: 0.95, n: 100 },
          { dimension: "fidelity", median: 0.85, p25: 0.78, p75: 0.92, n: 100 },
          { dimension: "commerce", median: 0.83, p25: 0.75, p75: 0.9, n: 100 },
          { dimension: "diversity", median: 0.81, p25: 0.74, p75: 0.88, n: 100 },
          { dimension: "safety", median: 0.95, p25: 0.9, p75: 0.99, n: 100 },
        ],
      }),
    }),
  );

  await gotoHash(page, "/scoring");
  for (const dim of ["naturalness", "fidelity", "commerce", "diversity", "safety"]) {
    await expect(page.getByText(dim, { exact: true })).toBeVisible();
  }
  await expect(page.getByText("Overall IDS (composite)")).toBeVisible();
  await expectNoConsoleErrors(watcher);
});
