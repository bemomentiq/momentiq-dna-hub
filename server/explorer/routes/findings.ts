import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { DNA_FOCUS_AREAS } from "@shared/dna-focus-areas";

export function registerFindingsRoutes(app: Express) {
  // ============ Findings ============
  app.get("/api/findings", (req, res) => {
    const status = (req.query.status as string) || undefined;
    const action_name = (req.query.action_name as string) || undefined;
    // focus_area filter: a focus_area id, or the literal string "uncategorized"
    // to fetch legacy/unlabelled findings.
    const focusParam = req.query.focus_area as string | undefined;
    let focus_area: string | null | undefined;
    if (focusParam === "uncategorized") focus_area = null;
    else if (focusParam) focus_area = focusParam;
    else focus_area = undefined;
    res.json(storage.listFindings({ status, action_name, focus_area, limit: 200 }));
  });

  // DNA-8: focus-area registry + counts in the last 7 days for the Explorer rail.
  app.get("/api/findings/focus-areas", (_req, res) => {
    const counts = storage.focusAreaCounts(7);
    const byId = new Map(counts.map((c) => [c.focus_area, c.count] as const));
    const areas = DNA_FOCUS_AREAS.map((a) => ({
      id: a.id,
      label: a.label,
      description: a.description,
      count_7d: byId.get(a.id) ?? 0,
    }));
    const uncategorized_count_7d = byId.get(null) ?? 0;
    res.json({ areas, uncategorized_count_7d });
  });
  app.patch("/api/findings/:id", (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = z.object({ status: z.enum(["open", "accepted", "dismissed", "superseded"]).optional() }).parse(req.body);
    const u = storage.updateFinding(id, updates);
    if (!u) return void res.status(404).json({ error: "not found" });
    res.json(u);
  });

  // ============ Ledger ============
  app.get("/api/ledger", (_req, res) => res.json(storage.listLedger(50)));
}
