import { expect, test } from "@playwright/test";
import { expectNoConsoleErrors, gotoHash, watchConsole } from "./helpers";
import { ROUTES } from "./routes";

// One test per route. Asserts:
//   1. The Vite-served index.html returns 200 (implicit in page.goto).
//   2. The page renders its h1 (Layout's text-page-title) with the expected text.
//   3. No console errors fire while the page mounts.
// Hash routing means every URL is "/#/<path>"; the document itself is always
// the same / response, so this is closer to "every route mounts cleanly" than
// "every route returns 200" — but the issue spec phrases it the latter way.
for (const route of ROUTES) {
  test(`route ${route.path} mounts and renders heading`, async ({ page }) => {
    const watcher = watchConsole(page);

    const response = await page.goto(`/#${route.path}`);
    expect(response, `goto /#${route.path} returned no response`).not.toBeNull();
    expect(response!.status(), `index.html should serve 200 for /#${route.path}`).toBe(200);

    const heading = page.getByTestId("text-page-title");
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText(route.title);

    // Allow react-query to settle so any deferred fetch errors show up.
    await page.waitForLoadState("networkidle");
    await expectNoConsoleErrors(watcher);
  });
}

test("sidebar exposes every nav target", async ({ page }) => {
  await gotoHash(page, "/");
  // Sample a handful of stable nav data-testids — keeps this resilient to
  // future menu re-orders while still proving the chrome is wired up.
  const probes = [
    "nav-overview",
    "nav-a/b-runs",
    "nav-ids-scoring",
    "nav-pipeline-health",
    "nav-fleet-runs",
    "nav-run-on-fleet",
  ];
  for (const tid of probes) {
    await expect(page.getByTestId(tid)).toBeVisible();
  }
});
