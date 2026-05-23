import type { Express } from "express";
import { storage } from "../../storage";
import { buildExplorerPrompt } from "../prompt";

export function registerStatsRoutes(app: Express) {
  // ============ Stats ============
  app.get("/api/explorer/stats", (_req, res) => res.json(storage.stats()));
  app.get("/api/explorer/stats/v2", (_req, res) => res.json(storage.explorerStats()));

  // Get prompt for a run (useful for manual subagent dispatch / debugging)
  app.get("/api/explorer/runs/:id/prompt", async (req, res) => {
    const id = parseInt(req.params.id, 10);
    res.type("text/plain").send(await buildExplorerPrompt(id));
  });
}
