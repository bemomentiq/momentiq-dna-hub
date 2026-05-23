import type { ConsoleMessage, Page } from "@playwright/test";
import { expect } from "@playwright/test";

// App uses wouter's hash router, so every route renders under "/#/<path>".
// Helper centralizes that so individual specs don't have to remember.
export function hashUrl(path: string): string {
  if (!path.startsWith("/")) path = `/${path}`;
  return `/#${path}`;
}

// Console messages we treat as noise rather than regressions. These come from
// dev-only tooling (vite client, react devtools) or third-party iframes the
// app embeds and we don't control.
const CONSOLE_NOISE = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /\[HMR\]/i,
  /sourcemap/i,
  /Failed to load resource:.*favicon/i,
  /Manifest:/i,
  /\[Fast Refresh\]/i,
];

export type ConsoleWatcher = {
  errors: string[];
  pageErrors: Error[];
};

/**
 * Start listening to page console errors + uncaught page exceptions. Call
 * `expect(watcher.errors).toEqual([])` (and same for pageErrors) at the end
 * of a test. Filters out known dev-only noise.
 */
export function watchConsole(page: Page): ConsoleWatcher {
  const watcher: ConsoleWatcher = { errors: [], pageErrors: [] };
  const onMsg = (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (CONSOLE_NOISE.some((rx) => rx.test(text))) return;
    watcher.errors.push(text);
  };
  page.on("console", onMsg);
  page.on("pageerror", (err) => {
    if (CONSOLE_NOISE.some((rx) => rx.test(err.message))) return;
    watcher.pageErrors.push(err);
  });
  return watcher;
}

/**
 * Navigate to a hash-router path and wait for the page title to appear.
 * Returns the resolved title text so callers can sanity-check it.
 */
export async function gotoHash(page: Page, path: string): Promise<string> {
  await page.goto(hashUrl(path));
  // The h1 is rendered inside Layout and is the most stable readiness signal.
  const heading = page.getByTestId("text-page-title");
  await expect(heading).toBeVisible();
  return (await heading.textContent())?.trim() ?? "";
}

export async function expectNoConsoleErrors(watcher: ConsoleWatcher): Promise<void> {
  expect.soft(watcher.pageErrors.map((e) => e.message), "uncaught page exceptions").toEqual([]);
  expect.soft(watcher.errors, "console errors").toEqual([]);
}
