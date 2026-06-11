import type { Express } from "express";
import { registerCronRoutes } from "./routes/cron";
import { registerRunsRoutes } from "./routes/runs";
import { registerFindingsRoutes } from "./routes/findings";
import { registerDraftTasksRoutes } from "./routes/draft-tasks";
import { registerDispatchFleetRoutes } from "./routes/dispatch-fleet";
import { registerStatsRoutes } from "./routes/stats";
import { registerFeedbackRoutes } from "./routes/feedback";

export function registerExplorerRoutes(app: Express) {
  // Sub-registrars are invoked in the original source order so route
  // precedence is preserved. Each registers a distinct concern's handlers.
  registerCronRoutes(app);
  registerRunsRoutes(app);
  registerFindingsRoutes(app);
  registerDraftTasksRoutes(app);
  registerDispatchFleetRoutes(app);
  registerStatsRoutes(app);
  registerFeedbackRoutes(app);
}
