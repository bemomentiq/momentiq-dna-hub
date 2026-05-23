import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";

// Mocks the Run-on-Fleet dispatch path: the form posts to /api/run/dispatch,
// then the list polls /api/fleet/runs. We replay a "queued → running →
// completed" transition by swapping the GET payload between requests.
type FleetRun = {
  id: number;
  kind: "ad_hoc";
  started_at: string;
  finished_at: string | null;
  status: "queued" | "running" | "completed";
  trigger: string;
  executor: string;
  fallback_executor: string | null;
  model: string;
  priority: string;
  repo_url: string;
  cc_task_id: number | null;
  cc_task_status: string | null;
  gh_issue_numbers_json: string;
  gh_pr_url: string | null;
  gh_pr_state: string | null;
  user_prompt: string | null;
  agent_briefing: string;
  summary: string;
  error: string | null;
  duration_ms: number;
};

function newRun(status: FleetRun["status"], summary = ""): FleetRun {
  return {
    id: 9001,
    kind: "ad_hoc",
    started_at: new Date().toISOString(),
    finished_at: status === "completed" ? new Date().toISOString() : null,
    status,
    trigger: "ui",
    executor: "pin-codex-direct",
    fallback_executor: null,
    model: "gpt_5_5",
    priority: "p0",
    repo_url: "https://github.com/bemomentiq/momentiq-dna-hub",
    cc_task_id: 4242,
    cc_task_status: null,
    gh_issue_numbers_json: "[]",
    gh_pr_url: null,
    gh_pr_state: null,
    user_prompt: "Smoke test from playwright dispatch.spec",
    agent_briefing: "(briefing)",
    summary,
    error: null,
    duration_ms: status === "completed" ? 12_345 : 0,
  };
}

test("dispatch a smoke task and watch it progress on the Run page", async ({ page }) => {
  const watcher = watchConsole(page);

  let phase: "empty" | "queued" | "running" | "completed" = "empty";

  await page.route("**/api/fleet/runs", async (route) => {
    const runs: FleetRun[] =
      phase === "empty"
        ? []
        : phase === "completed"
        ? [newRun("completed", "All smoke checks passed.")]
        : [newRun(phase)];
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(runs) });
  });

  await page.route("**/api/run/dispatch", async (route) => {
    phase = "queued";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        run: newRun("queued"),
        model_pin: "gpt_5_5",
        direct: true,
        agentId: "mini-5-direct-codex",
        pid: 1234,
        cc_task_id: 4242,
      }),
    });
  });

  await gotoHash(page, "/run");

  // Empty state is up.
  await expect(page.getByText("No ad-hoc runs yet")).toBeVisible();

  // Fill in the dispatch form. The button is disabled until the prompt is ≥5 chars.
  const prompt = page.getByPlaceholder(/Add a new endpoint/);
  await prompt.fill("Smoke test from playwright dispatch.spec — please /api/healthz round-trip");

  const dispatchButton = page.getByRole("button", { name: /Dispatch to fleet/i });
  await expect(dispatchButton).toBeEnabled();
  await dispatchButton.click();

  // The success banner names the model pin + agentId we mocked back.
  await expect(page.getByText(/Dispatched run #9001/)).toBeVisible();
  await expect(page.getByText(/mini-5-direct-codex/)).toBeVisible();

  // Queued row appears.
  await expect(page.getByText(/Smoke test from playwright/).first()).toBeVisible();
  await expect(page.getByText("queued", { exact: true }).first()).toBeVisible();

  // Flip to running, force a re-fetch, assert status pill flipped.
  phase = "running";
  await page.evaluate(() => fetch("/api/fleet/runs")); // warm the cache; UI re-polls in 5s anyway.
  await expect(page.getByText("running", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  // Then flip to completed and assert summary surfaces.
  phase = "completed";
  await expect(page.getByText("completed", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("All smoke checks passed.")).toBeVisible({ timeout: 15_000 });

  await expectNoConsoleErrors(watcher);
});
