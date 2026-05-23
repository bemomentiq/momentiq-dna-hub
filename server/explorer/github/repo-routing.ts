// Repo + area routing helpers for the GitHub sync layer (split from github-sync.ts).

import type { DraftTask } from "@shared/schema";

// Repo mapping
export function pickRepoForTask(t: DraftTask, cfg: { default_gh_repo: string; frontend_gh_repo: string }): string {
  if (t.repo_url?.includes("-frontend")) return cfg.frontend_gh_repo;
  if (t.area && /^(ui|frontend|fe|visual|dashboard)$/i.test(t.area)) return cfg.frontend_gh_repo;
  try {
    const skills: string[] = JSON.parse(t.relevant_skills_json || "[]");
    if (skills.some((s) => /website|webapp|frontend|ui/i.test(s))) return cfg.frontend_gh_repo;
  } catch { /* */ }
  return cfg.default_gh_repo;
}

const AREA_KEYWORDS: { area: string; patterns: RegExp[] }[] = [
  { area: "evals", patterns: [/eval_pass/, /scorer/i, /\bevals\b/i, /quality score/i, /SCORER_VERSION/] },
  { area: "drift", patterns: [/drift/i, /page-hinkley/i, /\brho\b/i, /auto[_-]revert/i] },
  { area: "money-path", patterns: [/money[- ]path/i, /payment/i, /reconcil/i, /compensation/i, /fixed[_ ]rate/i] },
  { area: "training-data", patterns: [/training (?:data|corpus|rows|backfill)/i, /Reacher/i, /cross.shop learnings/i, /gold pairs/i] },
  { area: "hitl", patterns: [/HITL/i, /tina_review/i, /hitl_decision_log/i, /gate flip/i] },
  { area: "pipeline", patterns: [/pipeline/i, /ingest/i, /ETL/i, /cron/i] },
  { area: "sampling", patterns: [/sampling/i, /outreach/i, /\bdraft[_ ]outreach/i] },
  { area: "paid-deal", patterns: [/paid_deal/i, /PD\d+/, /offer/i, /contract/i] },
  { area: "frontend", patterns: [/\bUI\b/, /frontend/i, /dashboard/i, /React component/i, /\.tsx/] },
];

export function inferArea(t: Pick<DraftTask, "title" | "description" | "agent_briefing" | "relevant_skills_json" | "area">): string {
  if (t.area) return t.area;
  const corpus = `${t.title}\n${t.description}\n${t.agent_briefing}`;
  for (const { area, patterns } of AREA_KEYWORDS) {
    if (patterns.some((p) => p.test(corpus))) return area;
  }
  return "general";
}

// Parse the [PREFIX-N] from a draft title, e.g. "[AH-EXPLORE-1] foo" -> "AH-EXPLORE-1"
export function extractPrefix(title: string): string | null {
  const m = title.match(/^\[([A-Z0-9][A-Z0-9_-]+)\]/);
  return m?.[1] ?? null;
}

export function parseEffortHours(effort: string): number {
  const m = effort.match(/(\d+(?:\.\d+)?)\s*(hr|hour|d|day)/i);
  if (!m) return 2;
  const n = parseFloat(m[1]);
  return /d|day/i.test(m[2]) ? n * 8 : n;
}
