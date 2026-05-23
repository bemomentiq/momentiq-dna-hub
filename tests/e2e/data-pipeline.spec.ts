import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// The issue spec calls for "7 stages render" — the current Pipeline Health
// page exposes a 4-stage ScriptSage funnel (submitted → started → succeeded →
// high_quality) plus a 6-tile queue-stat strip. Together that's 10 stage-ish
// indicators; we lock both: every funnel stage MUST appear, and the queue
// strip MUST render its 6 named tiles.
const FUNNEL_STAGES = ["submitted", "started", "succeeded", "high quality"];
const QUEUE_TILES = ["Pending", "Processing", "p50 latency", "p95 latency", "Stalled", "Errors 24h"];

function mockHealth(page: import("@playwright/test").Page) {
  page.route("**/api/content-platform/scriptsage/queue-health", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scriptsage_configured: true,
        queue: {
          pending: 4,
          processing: 2,
          p50_latency_ms: 850,
          p95_latency_ms: 4200,
          stalled_count: 0,
          computed_at: new Date().toISOString(),
        },
      }),
    }),
  );
  page.route("**/api/content-platform/scriptsage/failures", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ scriptsage_configured: true, failures: [] }),
    }),
  );
  page.route("**/api/content-platform/scriptsage/errors**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ scriptsage_configured: true, signatures: [], window_days: 7 }),
    }),
  );
  page.route("**/api/content-platform/scriptsage/funnel**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        scriptsage_configured: true,
        window_days: 7,
        funnels: [
          {
            pipeline: "scriptsage",
            category: "tiktok_shop",
            steps: [
              { stage: "submitted", count: 1000 },
              { stage: "started", count: 950 },
              { stage: "succeeded", count: 800 },
              { stage: "high_quality", count: 320 },
            ],
          },
        ],
      }),
    }),
  );
}

test.describe("Pipeline Health", () => {
  test("queue tiles + funnel stages render", async ({ page }) => {
    const watcher = watchConsole(page);
    mockHealth(page);
    await gotoHash(page, "/pipeline-health");

    for (const label of QUEUE_TILES) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    for (const stage of FUNNEL_STAGES) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }

    // Window switcher works (covered by the test-id baked into the chip).
    await expect(page.getByTestId("window-7")).toBeVisible();
    await expect(page.getByTestId("window-14")).toBeVisible();
    await expect(page.getByTestId("window-30")).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });

  test("shows scriptsage-not-configured state when upstream is missing", async ({ page }) => {
    const watcher = watchConsole(page);
    const empty = (extra: object) => ({ scriptsage_configured: false, ...extra });
    await page.route("**/api/content-platform/scriptsage/queue-health", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify(empty({ queue: null })) }),
    );
    await page.route("**/api/content-platform/scriptsage/failures", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify(empty({ failures: [] })) }),
    );
    await page.route("**/api/content-platform/scriptsage/errors**", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify(empty({ signatures: [], window_days: 7 })) }),
    );
    await page.route("**/api/content-platform/scriptsage/funnel**", (r) =>
      r.fulfill({ contentType: "application/json", body: JSON.stringify(empty({ funnels: [], window_days: 7 })) }),
    );

    await gotoHash(page, "/pipeline-health");
    await expect(page.getByText("ScriptSage not configured")).toBeVisible();
    await expectNoConsoleErrors(watcher);
  });
});
