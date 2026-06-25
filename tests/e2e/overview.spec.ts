import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// Overview renders 4 DNA hero tiles (IDS convergence, Bandit M11, win-rate,
// GMV Max ROAS) plus a 24h pipeline panel and a blockers panel. When the DNA
// service is unconfigured, the tiles show a "not connected" pill but the
// page still renders end-to-end without console errors.
const KPI_LABELS = [
  "IDS Convergence",
  "Bandit M11 Progress",
  "Video Win-Rate 24h",
  "GMV Max ROAS 7d",
];

const EMPTY_KPI_BODY = {
  ids_convergence_pct: null,
  bandit_m11_progress: null,
  video_win_rate_24h: null,
  gmv_max_roas_7d: null,
  videos_24h: null,
  videos_ids_pass_24h: null,
  outbound_used_24h: null,
  dna_configured: false,
  neon_available: false,
  ids_target: 0.85,
  prior_7d: null,
  recent_runs: [],
  fetched_at: new Date().toISOString(),
};

test.describe("Overview", () => {
  test("renders all DNA KPI tiles when DNA service is unconfigured", async ({ page }) => {
    const watcher = watchConsole(page);

    await page.route("**/api/overview/dna-kpis", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(EMPTY_KPI_BODY),
      }),
    );
    await page.route("**/api/gh-issues**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ issues: [] }),
      }),
    );

    await gotoHash(page, "/");

    for (const label of KPI_LABELS) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    await expect(page.getByText("not connected").first()).toBeVisible();
    await expect(page.getByText("DNA_API_BASE", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("DNA_NEON_READ_URL", { exact: false }).first()).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });

  test("renders numeric DNA KPI values + recent runs when data is present", async ({
    page,
  }) => {
    const watcher = watchConsole(page);

    await page.route("**/api/overview/dna-kpis", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ids_convergence_pct: 92,
          bandit_m11_progress: 65,
          video_win_rate_24h: 0.58,
          gmv_max_roas_7d: 3.42,
          videos_24h: 240,
          videos_ids_pass_24h: 188,
          outbound_used_24h: 96,
          dna_configured: true,
          neon_available: true,
          ids_target: 0.85,
          prior_7d: {
            ids_convergence_pct: 88,
            bandit_m11_progress: null,
            video_win_rate_24h: null,
            gmv_max_roas_7d: 3.05,
            videos_24h: 210,
            videos_ids_pass_24h: 160,
            outbound_used_24h: 80,
          },
          recent_runs: [
            {
              run_id: "abcdef1234567890",
              theme: "stationery-spring",
              status: "running",
              ids_mean: 0.87,
              started_at: "2026-05-20T10:00:00Z",
            },
            {
              run_id: "1234567890abcdef",
              theme: "kitchen-gadgets",
              status: "completed",
              ids_mean: 0.91,
              started_at: "2026-05-19T18:00:00Z",
            },
          ],
          fetched_at: new Date().toISOString(),
        }),
      }),
    );
    await page.route("**/api/gh-issues**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ issues: [] }),
      }),
    );

    await gotoHash(page, "/");

    await expect(page.getByTestId("stat-ids-convergence")).toContainText("92%");
    await expect(page.getByTestId("stat-bandit-m11-progress")).toContainText("65%");
    await expect(page.getByTestId("stat-video-win-rate-24h")).toContainText("58");
    await expect(page.getByTestId("stat-gmv-max-roas-7d")).toContainText("3.42×");

    // Recent-runs panel has two entries; one of them should render.
    await expect(page.getByTestId("recent-run-abcdef1234567890")).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });
});
