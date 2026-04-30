import type { Express, Request, Response } from "express";
import { storage } from "../storage";

export function registerSkillsRoutes(app: Express) {
  // Agents POST learned patterns here (Phase 5b of each run)
  app.post("/api/skills/update", (req: Request, res: Response) => {
    const { run_id, run_kind, skill_name, diff_summary, patch } = req.body || {};
    if (!skill_name || !diff_summary) {
      return void res.status(400).json({ error: "skill_name and diff_summary required" });
    }
    const db = storage.getDb();
    const row = db
      .prepare(
        `INSERT INTO skill_updates (created_at, run_id, run_kind, skill_name, diff_summary, patch)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
      )
      .get(
        new Date().toISOString(),
        run_id ?? null,
        run_kind ?? null,
        skill_name,
        diff_summary,
        patch ?? null
      ) as any;
    return void res.json({ ok: true, id: row.id });
  });

  app.get("/api/skills/updates", (_req: Request, res: Response) => {
    const db = storage.getDb();
    const rows = db.prepare("SELECT * FROM skill_updates ORDER BY id DESC LIMIT 100").all();
    return void res.json(rows);
  });

  app.patch("/api/skills/updates/:id/apply", (req: Request, res: Response) => {
    const db = storage.getDb();
    db.prepare("UPDATE skill_updates SET applied=1 WHERE id=?").run(req.params.id);
    return void res.json({ ok: true });
  });
}
