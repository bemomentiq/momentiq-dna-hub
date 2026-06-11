import type { Express } from "express";
import { getDnaKpis } from "../clients/dna-kpis";
import { DNA_PIPELINE_STAGES } from "../../shared/dna-pipeline-stages";

export function registerOverviewRoutes(app: Express) {
  // DNA-actual KPIs for the Overview + ExecutiveBrief pages. Aggregates IDS
  // convergence, bandit M11 progress, win-rate, GMV Max ROAS, 24h pipeline
  // volume, and outbound usage from dnaClient + optional Neon. Wrapped in a
  // 5-minute TTL cache inside getDnaKpis().
  app.get("/api/overview/dna-kpis", async (_req, res) => {
    res.json(await getDnaKpis());
  });

  // DNA data-pipeline stages — returns the canonical 7-stage roadmap (Kalodata
  // → Gemini Vision → DNA-knob → engine dispatch → post-proc → IDS scoring →
  // LoRA drift). Rollups are stubbed null pending the neon-signals rollup
  // wiring; the client renders the cold-state per stage so the page is
  // walkable end-to-end today.
  app.get("/api/data-pipeline/stages", (_req, res) => {
    const stages = DNA_PIPELINE_STAGES.map((s) => ({
      stage_id: s.id,
      label: s.label,
      description: s.description,
      focus_area: s.focus_area,
      logs_query: s.logs_query,
      throughput_24h: 0,
      success_pct: null,
      p95_ms: null,
      errors_24h: 0,
      last_run_at: null,
      recent_failures: [] as Array<{
        run_id: string | null;
        action_name: string;
        error_message: string | null;
        failed_at: string;
      }>,
    }));
    res.json({
      neon_configured: false,
      neon_error: "rollup wiring deferred — see follow-up issue",
      stages,
      fetched_at: new Date().toISOString(),
    });
  });
}
