import { expect, test } from "@playwright/test";
import { gotoHash } from "./helpers";
import { ROUTES } from "./routes";

// Visual regression baselines. First run on a new machine WILL fail with
// "A snapshot doesn't exist" — that's the expected baseline-write phase
// (the issue's acceptance criteria explicitly call this out). Re-run with
// `--update-snapshots` to commit baselines.
//
// We intentionally pin all upstream-driven endpoints to a stable "empty
// state" payload so screenshots don't churn from upstream data drift. The
// pages we screenshot here are the ones the operator hits day-to-day; the
// chart-heavy pages (themes, veo-cost) are skipped for now because they
// embed third-party SVG that's noisy under pixel diff.
const STABLE_PAGES = [
  { path: "/", name: "overview" },
  { path: "/scoring", name: "scoring" },
  { path: "/pipeline-health", name: "pipeline-health" },
  { path: "/fleet", name: "fleet" },
  { path: "/run", name: "run" },
];

test.describe("visual regression baseline", () => {
  test.beforeEach(async ({ page }) => {
    // Empty/null payloads keep screenshots deterministic.
    const json = (body: unknown) => ({ contentType: "application/json", body: JSON.stringify(body) });
    await page.route("**/api/content-platform/overview", (r) =>
      r.fulfill(
        json({
          dna_configured: false,
          scriptsage_configured: false,
          corpus: null,
          ab_runs_active: null,
          ids_median_7d: null,
          veo_spend_7d_usd: null,
          scriptsage: null,
          subscriptions: null,
          fetched_at: "1970-01-01T00:00:00.000Z",
        }),
      ),
    );
    await page.route("**/api/content-platform/ids-distribution**", (r) =>
      r.fulfill(json({ dna_configured: false, distributions: null, window_days: 7, fetched_at: "1970-01-01T00:00:00.000Z" })),
    );
    await page.route("**/api/content-platform/scriptsage/queue-health", (r) =>
      r.fulfill(json({ scriptsage_configured: false, queue: null })),
    );
    await page.route("**/api/content-platform/scriptsage/failures", (r) =>
      r.fulfill(json({ scriptsage_configured: false, failures: [] })),
    );
    await page.route("**/api/content-platform/scriptsage/errors**", (r) =>
      r.fulfill(json({ scriptsage_configured: false, signatures: [], window_days: 7 })),
    );
    await page.route("**/api/content-platform/scriptsage/funnel**", (r) =>
      r.fulfill(json({ scriptsage_configured: false, funnels: [], window_days: 7 })),
    );
    await page.route("**/api/fleet/runs", (r) => r.fulfill(json([])));
  });

  for (const p of STABLE_PAGES) {
    test(`baseline screenshot — ${p.name}`, async ({ page }) => {
      await gotoHash(page, p.path);
      await page.waitForLoadState("networkidle");
      // Mask the LastUpdated chip (timestamp shifts every render).
      const masks = [page.getByTestId("text-page-title").locator(".."), page.locator("header time")];
      await expect(page).toHaveScreenshot(`${p.name}.png`, {
        fullPage: true,
        animations: "disabled",
        mask: masks,
      });
    });
  }

  // Sanity test that always renders even if every page above is skipped due
  // to baseline mismatch — keeps the spec file from "all skipped" status.
  test("visual suite knows about expected routes", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(STABLE_PAGES.length);
  });
});
