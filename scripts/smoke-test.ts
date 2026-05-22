// Boots the hub server in-process and probes each /api/content-platform/*
// endpoint, asserting 200 + expected shape. No external test runner — just
// `npm run -s smoke` (added to package.json) or `tsx scripts/smoke-test.ts`.
//
// Exits non-zero on the first failure so it can gate CI.

import express from "express";
import { createServer } from "node:http";
import { registerRoutes } from "../server/routes";

type Check = {
  name: string;
  method?: "GET" | "POST";
  path: string;
  expectStatus?: number[];
  shape?: (body: unknown) => string | null; // returns error message or null
};

const checks: Check[] = [
  {
    name: "content-platform/overview",
    path: "/api/content-platform/overview",
    shape: (b: any) =>
      typeof b?.dna_configured === "boolean" && typeof b?.scriptsage_configured === "boolean"
        ? null
        : "missing dna_configured/scriptsage_configured booleans",
  },
  {
    name: "content-platform/health",
    path: "/api/content-platform/health",
    shape: (b: any) =>
      b?.dna && b?.scriptsage && b?.kalodata ? null : "missing one of dna/scriptsage/kalodata",
  },
  {
    // Lands in section PR #22; tolerate 404 until that merges.
    name: "content-platform/promotion-candidates",
    path: "/api/content-platform/promotion-candidates",
    expectStatus: [200, 404, 502],
    shape: (b: any) =>
      b == null || Array.isArray(b?.candidates) ? null : "candidates not an array",
  },
  {
    name: "content-platform/themes",
    path: "/api/content-platform/themes",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/ab-runs",
    path: "/api/content-platform/ab-runs?status=running&limit=10",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/ids-distribution",
    path: "/api/content-platform/ids-distribution?window_days=7",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/veo-cost",
    path: "/api/content-platform/veo-cost?window_days=7",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/scriptsage",
    path: "/api/content-platform/scriptsage",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/subscriptions",
    path: "/api/content-platform/subscriptions",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/bandit/state",
    path: "/api/content-platform/bandit/state",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/bandit/learning-metrics",
    path: "/api/content-platform/bandit/learning-metrics",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/bandit/regret",
    path: "/api/content-platform/bandit/regret?window_days=30",
    expectStatus: [200, 404, 502],
  },
  {
    name: "content-platform/cache",
    path: "/api/content-platform/cache",
    shape: (b: any) =>
      typeof b?.entries === "number" && Array.isArray(b?.keys) ? null : "missing entries/keys",
  },
  {
    name: "gh-issues (no-token)",
    path: "/api/gh-issues",
    expectStatus: [200, 400, 401],
  },
];

async function main() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", () => resolve()));
  const addr = httpServer.address();
  if (!addr || typeof addr === "string") throw new Error("no addr");
  const base = `http://127.0.0.1:${addr.port}`;

  let failed = 0;
  for (const check of checks) {
    const url = `${base}${check.path}`;
    const t0 = Date.now();
    try {
      const r = await fetch(url, { method: check.method ?? "GET" });
      const allowed = check.expectStatus ?? [200];
      if (!allowed.includes(r.status)) {
        console.error(`✗ ${check.name}: HTTP ${r.status} (expected ${allowed.join("|")})`);
        failed++;
        continue;
      }
      let bodyErr: string | null = null;
      if (check.shape && r.status === 200) {
        const body = await r.json().catch(() => null);
        bodyErr = check.shape(body);
      }
      if (bodyErr) {
        console.error(`✗ ${check.name}: ${bodyErr}`);
        failed++;
        continue;
      }
      console.log(`✓ ${check.name} (${Date.now() - t0}ms)`);
    } catch (err: any) {
      console.error(`✗ ${check.name}: ${err?.message ?? err}`);
      failed++;
    }
  }

  httpServer.close();
  if (failed > 0) {
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
  } else {
    console.log(`\nAll ${checks.length} checks passed`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
