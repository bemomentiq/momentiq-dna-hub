import type { Express } from "express";
import { storage } from "../storage";
import { fetchKalodataSignals } from "../explorer/kalodata-signals";

export function registerCompanionRoutes(app: Express) {
  // ============ Companion site signals ============
  app.get("/api/companion-signals", async (_req, res) => {
    const signals = await fetchKalodataSignals();
    res.json(signals);
  });

  // ============ Readiness snapshot (companion API proxy + persist) ============
  app.get("/api/readiness-snapshot", async (_req, res) => {
    try {
      const cfg = storage.getCronConfig();
      const companionUrl = (cfg as any).companion_site_url || "https://kalodata-ai-content-platform-t.pplx.app";
      const snap = await fetch(`${companionUrl}/api/readiness`).then(r => r.json()).catch(() => null);
      const rawDb = storage.getDb();
      if (snap) {
        rawDb.prepare(
          "INSERT INTO readiness_snapshots (fetched_at, source, payload_json, summary) VALUES (?, ?, ?, ?)"
        ).run(new Date().toISOString(), "kalodata_readiness", JSON.stringify(snap), snap.summary || "");
      }
      const latest = rawDb.prepare("SELECT * FROM readiness_snapshots ORDER BY id DESC LIMIT 1").get();
      res.json(latest || { completion_pct: 0, total_items: 0 });
    } catch (e) {
      res.json({ completion_pct: 0, total_items: 0, error: "companion site unavailable" });
    }
  });
}
