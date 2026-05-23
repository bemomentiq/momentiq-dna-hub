import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// The overview page renders 8 StatCard tiles (Corpus / A/B / IDS / Veo /
// Scripts / Videos / Fallback / MRR). When upstream services are not
// connected each tile shows a "not connected" pill but still renders.
const KPI_LABELS = [
  "Corpus Videos",
  "Active A/B Runs",
  "IDS Median 7d",
  "Veo Spend 7d",
  "ScriptSage Scripts /24h",
  "ScriptSage Videos /24h",
  "Fallback / Error Rate",
  "MRR · Subscribers",
];

test.describe("Overview", () => {
  test("renders all KPI tiles when upstreams are unconfigured", async ({ page }) => {
    const watcher = watchConsole(page);

    // Force the empty-state path so the test is hermetic regardless of what
    // env vars the dev server happens to inherit.
    await page.route("**/api/content-platform/overview", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          dna_configured: false,
          scriptsage_configured: false,
          corpus: null,
          ab_runs_active: null,
          ids_median_7d: null,
          veo_spend_7d_usd: null,
          scriptsage: null,
          subscriptions: null,
          fetched_at: new Date().toISOString(),
        }),
      }),
    );

    await gotoHash(page, "/");

    for (const label of KPI_LABELS) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // "not connected" italic chip is the empty-state signal.
    await expect(page.getByText("not connected").first()).toBeVisible();

    // The configuration warning block calls out both env vars by name.
    await expect(page.getByText("DNA_API_BASE")).toBeVisible();
    await expect(page.getByText("SCRIPTSAGE_API_BASE")).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });

  test("renders numeric KPI values when upstreams return data", async ({ page }) => {
    const watcher = watchConsole(page);

    await page.route("**/api/content-platform/overview", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          dna_configured: true,
          scriptsage_configured: true,
          corpus: { videos: 12345, gmv_usd: 678900, last_harvest_at: null },
          ab_runs_active: 7,
          ids_median_7d: 0.91,
          veo_spend_7d_usd: 4321.5,
          scriptsage: {
            scripts_generated_24h: 200,
            scripts_generated_7d: 1400,
            videos_generated_24h: 88,
            videos_generated_7d: 600,
            fallback_rate_24h: 0.03,
            error_rate_24h: 0.01,
            status_sync_lag_seconds: 5,
          },
          subscriptions: {
            active_users: 240,
            mrr_usd: 9800,
            tier_mix: [],
            top_users_by_credit_burn: [],
          },
          fetched_at: new Date().toISOString(),
        }),
      }),
    );

    await gotoHash(page, "/");

    await expect(page.getByTestId("stat-corpus-videos")).toContainText("12,345");
    await expect(page.getByTestId("stat-active-a/b-runs")).toContainText("7");
    await expect(page.getByTestId("stat-ids-median-7d")).toContainText("0.91");
    // ≥0.85 should tag the IDS tile as "passing".
    await expect(page.getByText("≥0.85")).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });
});
