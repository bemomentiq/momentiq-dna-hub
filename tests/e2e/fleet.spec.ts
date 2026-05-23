import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

type FleetRun = {
  id: number;
  kind: "executor_cron" | "ad_hoc";
  started_at: string;
  finished_at: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  trigger: string;
  executor: string;
  model: string;
  priority: string;
  repo_url: string;
  cc_task_id: number | null;
  gh_issue_numbers_json: string;
  gh_pr_url: string | null;
  gh_pr_state: string | null;
  user_prompt: string | null;
  agent_briefing: string;
  summary: string;
  error: string | null;
  duration_ms: number;
};

function mk(
  id: number,
  kind: FleetRun["kind"],
  status: FleetRun["status"],
  extras: Partial<FleetRun> = {},
): FleetRun {
  return {
    id,
    kind,
    started_at: new Date().toISOString(),
    finished_at: status === "running" ? null : new Date().toISOString(),
    status,
    trigger: kind === "executor_cron" ? "cron" : "ui",
    executor: "pin-codex",
    model: "gpt_5_5",
    priority: "p1",
    repo_url: "https://github.com/bemomentiq/momentiq-dna-hub",
    cc_task_id: 1000 + id,
    gh_issue_numbers_json: "[42]",
    gh_pr_url: status === "completed" ? `https://github.com/owner/repo/pull/${id}` : null,
    gh_pr_state: status === "completed" ? "merged" : null,
    user_prompt: kind === "ad_hoc" ? "User-supplied prompt for run " + id : null,
    agent_briefing: "(briefing)",
    summary: status === "completed" ? "Done." : "",
    error: null,
    duration_ms: status === "running" ? 0 : 30_000,
    ...extras,
  };
}

test.describe("Fleet Runs page", () => {
  test("renders summary tiles + executor/ad-hoc sections with rows", async ({ page }) => {
    const watcher = watchConsole(page);

    await page.route("**/api/fleet/runs", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify([
          mk(1, "executor_cron", "completed"),
          mk(2, "executor_cron", "running"),
          mk(3, "ad_hoc", "failed"),
          mk(4, "ad_hoc", "completed"),
        ]),
      }),
    );

    await gotoHash(page, "/fleet");

    // The 5-tile summary strip (Total / Running / Completed / PRs merged / Failed).
    for (const label of ["Total runs", "Running", "Completed", "PRs merged", "Failed"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }

    // Both sections render with their counts.
    await expect(page.getByText("Executor cron runs")).toBeVisible();
    await expect(page.getByText("Ad-hoc runs")).toBeVisible();

    // At least one row per section — row chrome shows the #id badge.
    await expect(page.getByText("#1")).toBeVisible();
    await expect(page.getByText("#3")).toBeVisible();

    // Status pills surface for completed + failed runs.
    await expect(page.getByText("completed", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("failed", { exact: true }).first()).toBeVisible();

    await expectNoConsoleErrors(watcher);
  });

  test("empty state appears when there are no runs", async ({ page }) => {
    const watcher = watchConsole(page);
    await page.route("**/api/fleet/runs", (route) =>
      route.fulfill({ contentType: "application/json", body: "[]" }),
    );
    await gotoHash(page, "/fleet");
    // Both sections render "No runs yet" cards.
    await expect(page.getByText("No runs yet").first()).toBeVisible();
    await expectNoConsoleErrors(watcher);
  });
});
