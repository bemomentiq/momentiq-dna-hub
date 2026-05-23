import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// The Run-on-Fleet page mounts a LiveTail block when an ad-hoc run is
// running on the direct tunnel (pin-{codex,claude}-direct) and the row is
// expanded. We mock both the run listing and the poll endpoint to verify
// stdout/stderr blocks render with the expected content.

test("live log tail renders stdout + stderr from poll endpoint", async ({ page }) => {
  const watcher = watchConsole(page);

  const runningRun = {
    id: 7777,
    kind: "ad_hoc",
    started_at: new Date().toISOString(),
    finished_at: null,
    status: "running",
    trigger: "ui",
    executor: "pin-codex-direct",
    fallback_executor: null,
    model: "gpt_5_5",
    priority: "p0",
    repo_url: "https://github.com/bemomentiq/momentiq-dna-hub",
    cc_task_id: null,
    cc_task_status: null,
    gh_issue_numbers_json: "[]",
    gh_pr_url: null,
    gh_pr_state: null,
    user_prompt: "Test the live tail",
    agent_briefing: "(briefing body)",
    summary: "",
    error: null,
    duration_ms: 0,
  };

  await page.route("**/api/fleet/runs", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([runningRun]),
    }),
  );

  const stdoutText = "FAKE_STDOUT: planning step 1 of 5";
  const stderrText = "FAKE_STDERR: warning about cache miss";

  await page.route("**/api/fleet/runs/7777/poll", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        alive: true,
        exited: false,
        stdout_tail: stdoutText,
        stderr_tail: stderrText,
        agentId: "mini-5-direct-codex",
        workdir: "/tmp/wt-7777",
      }),
    }),
  );

  await gotoHash(page, "/run");

  // The list row is visible.
  await expect(page.getByText(/Test the live tail/).first()).toBeVisible();

  // Expand to reveal LiveTail.
  await page.getByRole("button", { name: "Details" }).first().click();

  await expect(page.getByText(/Live tail.*mini-5 direct/)).toBeVisible();
  await expect(page.getByText("alive")).toBeVisible();
  await expect(page.getByText(stdoutText)).toBeVisible();
  await expect(page.getByText(stderrText)).toBeVisible();

  // "stdout" / "stderr" labels are the scroll-pinned section headers.
  await expect(page.getByText("stdout", { exact: true })).toBeVisible();
  await expect(page.getByText("stderr", { exact: true })).toBeVisible();

  await expectNoConsoleErrors(watcher);
});

test("agent briefing pre is shown when row is expanded", async ({ page }) => {
  const watcher = watchConsole(page);

  await page.route("**/api/fleet/runs", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: 8888,
          kind: "ad_hoc",
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: "completed",
          trigger: "ui",
          executor: "pin-codex",
          fallback_executor: null,
          model: "gpt_5_5",
          priority: "p1",
          repo_url: "https://github.com/bemomentiq/momentiq-dna-hub",
          cc_task_id: 5000,
          cc_task_status: "completed",
          gh_issue_numbers_json: "[]",
          gh_pr_url: null,
          gh_pr_state: null,
          user_prompt: "Briefing visibility test",
          agent_briefing: "BRIEFING_MARKER_FOR_TESTS",
          summary: "ok",
          error: null,
          duration_ms: 4321,
        },
      ]),
    }),
  );

  await gotoHash(page, "/run");
  await page.getByRole("button", { name: "Details" }).first().click();
  await expect(page.getByText("BRIEFING_MARKER_FOR_TESTS")).toBeVisible();
  await expectNoConsoleErrors(watcher);
});
