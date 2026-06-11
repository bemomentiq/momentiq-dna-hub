import type { Express } from "express";
import type { Server } from "node:http";
import { registerExplorerRoutes } from "./explorer/routes";
import { registerFleetRoutes } from "./explorer/fleet-routes";
import { registerDispatchRoutes } from "./explorer/dispatch-log";
import { registerPrBabysitterRoutes } from "./explorer/pr-babysitter";
import { registerTestDebugRoutes } from "./explorer/test-debug";
import { registerSkillsRoutes } from "./explorer/skills";
import { startAutoResumer, startReaper } from "./explorer/auto-resume";
import { hubAuth } from "./middleware/auth";
import { registerHealthRoutes } from "./health";
import { registerGithubRoutes } from "./routes/github";
import { registerContentPlatformRoutes } from "./routes/content-platform";
import { registerScriptsageRoutes } from "./routes/scriptsage";
import { registerBanditRoutes } from "./routes/bandit";
import { registerAutonomyRoutes } from "./routes/autonomy";
import { registerCompanionRoutes } from "./routes/companion";
import { registerOpsRoutes } from "./routes/ops";
import { registerOverviewRoutes } from "./routes/overview";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Health check first — must be reachable without auth so Railway / uptime
  // monitors can probe it. registerHealthRoutes() mounts GET /api/health.
  registerHealthRoutes(app);

  // Auth gate on /api/* (skips /api/health and /api/pr-babysitter/webhook).
  // Requires X-Hub-Token header matching HUB_TOKEN env. When HUB_TOKEN is unset
  // (dev / first boot) the middleware logs once and passes through.
  app.use(hubAuth());

  registerExplorerRoutes(app);
  registerFleetRoutes(app);
  registerPrBabysitterRoutes(app);
  registerTestDebugRoutes(app);
  registerSkillsRoutes(app);
  // Always-on auto-resume loop (checks every 30s, respects cron_config flags)
  startAutoResumer();
  startReaper();
  registerDispatchRoutes(app);

  // Inline route groups extracted into ./routes/* submodules. Registered in the
  // original source order so route precedence is preserved.
  registerGithubRoutes(app);
  registerOverviewRoutes(app);
  registerContentPlatformRoutes(app);
  registerScriptsageRoutes(app);
  registerBanditRoutes(app);
  registerAutonomyRoutes(app);
  registerCompanionRoutes(app);
  registerOpsRoutes(app);

  // SID-era endpoints removed during content-platform redesign:
  // /api/actions, /api/actions/:name, /api/rollups, /api/hitl-burden,
  // /api/feed, /api/money-path, /api/data-pipeline.
  // Replacements live under /api/content-platform/* (themes, ab-runs,
  // ids-distribution, veo-cost, scriptsage, subscriptions, roadmap).

  // /api/roadmap (hardcoded A–G phases) and /api/exec-brief.md (SID rollups)
  // removed during content-platform redesign. New equivalents:
  //   /api/content-platform/roadmap  (live GitHub milestones across 4 repos)
  //   /api/content-platform/overview (corpus / A/B / IDS / Veo / ScriptSage)
  //   /api/content-platform/promotion-candidates

  // /api/actions.csv removed (SID action grid). Content-platform exports
  // are per-section endpoints under /api/content-platform/*.

  return httpServer;
}
