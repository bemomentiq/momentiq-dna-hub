import { storage } from "../storage";

function resolveCompanionBaseUrl(): string {
  try {
    const cfg = storage.getCronConfig();
    if (cfg.companion_site_url) return cfg.companion_site_url;
  } catch {
    // storage not yet initialized — fall through to env/default
  }
  return process.env.KALODATA_API_URL || "https://kalodata.com";
}

export interface ReadinessSignal {
  category: string;
  completion_pct: number;
  blocked_items: string[];
  last_updated: string;
}

export interface RoadmapStateSignal {
  current_phase: string;
  phases: { id: string; title: string; status: string; progress_pct: number }[];
  next_milestone: string;
  blocked_epics: string[];
}

export async function fetchKalodataSignals(): Promise<{
  readiness: ReadinessSignal[] | null;
  roadmapState: RoadmapStateSignal | null;
}> {
  const KALODATA_BASE = resolveCompanionBaseUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.KALODATA_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let readiness: ReadinessSignal[] | null = null;
  let roadmapState: RoadmapStateSignal | null = null;

  try {
    const r1 = await fetch(`${KALODATA_BASE}/api/readiness`, { headers });
    if (r1.ok) {
      const data = await r1.json();
      readiness = data as ReadinessSignal[];
    }
  } catch {
    // companion API is optional — silently skip
  }

  try {
    const r2 = await fetch(`${KALODATA_BASE}/api/roadmap-state`, { headers });
    if (r2.ok) {
      const data = await r2.json();
      roadmapState = data as RoadmapStateSignal;
    }
  } catch {
    // companion API is optional — silently skip
  }

  // Persist snapshot if either signal fetched
  if (readiness || roadmapState) {
    const db = storage.getDb();
    if (readiness) {
      db.prepare(
        `INSERT INTO readiness_snapshots (fetched_at, source, payload_json, summary)
         VALUES (?, 'kalodata_readiness', ?, ?)`
      ).run(
        new Date().toISOString(),
        JSON.stringify(readiness),
        buildReadinessSummary(readiness)
      );
    }
    if (roadmapState) {
      db.prepare(
        `INSERT INTO readiness_snapshots (fetched_at, source, payload_json, summary)
         VALUES (?, 'kalodata_roadmap', ?, ?)`
      ).run(
        new Date().toISOString(),
        JSON.stringify(roadmapState),
        buildRoadmapSummary(roadmapState)
      );
    }
  }

  return { readiness, roadmapState };
}

function buildReadinessSummary(signals: ReadinessSignal[]): string {
  const sorted = [...signals].sort((a, b) => a.completion_pct - b.completion_pct);
  const lowestThree = sorted.slice(0, 3);
  return `Readiness: ${signals.length} categories. Lowest: ${lowestThree.map((s) => `${s.category} ${s.completion_pct}%`).join(", ")}.`;
}

function buildRoadmapSummary(state: RoadmapStateSignal): string {
  const blocked = state.blocked_epics.length;
  return `Phase ${state.current_phase}. Next milestone: ${state.next_milestone}. Blocked epics: ${blocked}.`;
}

export async function getLatestReadinessContext(): Promise<string> {
  const db = storage.getDb();
  const row = db
    .prepare("SELECT summary FROM readiness_snapshots WHERE source='kalodata_readiness' ORDER BY id DESC LIMIT 1")
    .get() as { summary: string } | undefined;
  return row?.summary || "No readiness snapshot available yet.";
}

export async function getLatestRoadmapContext(): Promise<string> {
  const db = storage.getDb();
  const row = db
    .prepare("SELECT summary FROM readiness_snapshots WHERE source='kalodata_roadmap' ORDER BY id DESC LIMIT 1")
    .get() as { summary: string } | undefined;
  return row?.summary || "No roadmap state snapshot available yet.";
}
