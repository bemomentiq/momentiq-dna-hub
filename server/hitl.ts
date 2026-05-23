// HITL (human-in-the-loop) review queue + burden aggregates for DR/IPS lints,
// RAI softener, and brand-safety gates. Synthetic but deterministic per-day
// until an upstream HITL service is wired (see #DNA-6).

export type HitlGate = "dr" | "ips" | "rai" | "brand_safety";
const GATES: readonly HitlGate[] = ["dr", "ips", "rai", "brand_safety"] as const;
const GATE_LABELS: Record<HitlGate, string> = {
  dr: "DR lint",
  ips: "IPS lint",
  rai: "RAI softener",
  brand_safety: "Brand safety",
};
// Per-gate baseline review time (minutes). brand_safety is the slow bottleneck
// because it routes through a second-pair-of-eyes legal pass.
const GATE_BASE_MIN: Record<HitlGate, number> = { dr: 4, ips: 5, rai: 8, brand_safety: 14 };
const REVIEWERS = ["alex", "morgan", "sam", "priya", "kenji"] as const;

export type HitlItem = {
  id: string;
  gate: HitlGate;
  video_id: string;
  queued_at: string;
  reviewer: string | null;
  reviewed_at: string | null;
  decision: "approved" | "rejected" | "softened" | "pending";
};

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length)]!;
const dayOfYearUtc = (d: Date) =>
  Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 0)) / 86_400_000);

function generateItems(now: Date, total = 80): HitlItem[] {
  const seed = dayOfYearUtc(now) + now.getUTCFullYear() * 1000;
  const r = mulberry32(seed);
  const out: HitlItem[] = [];
  for (let i = 0; i < total; i++) {
    const gate = pick(r, GATES);
    const queued = new Date(now.getTime() - Math.floor(r() * 60 * 24 * 7) * 60_000);
    const id = `hitl_${seed}_${i}`;
    const video_id = `vid_${Math.floor(r() * 1e6).toString(36)}`;
    if (r() >= 0.78) {
      out.push({ id, gate, video_id, queued_at: queued.toISOString(), reviewer: null, reviewed_at: null, decision: "pending" });
      continue;
    }
    const reviewMin = Math.max(1, Math.round(GATE_BASE_MIN[gate] * (0.4 + r() * 1.6)));
    const reviewedAt = new Date(queued.getTime() + reviewMin * 60_000);
    const v = r();
    const decision: HitlItem["decision"] =
      gate === "rai" && v < 0.32 ? "softened" : v < 0.75 ? "approved" : v < 0.88 ? "softened" : "rejected";
    out.push({
      id, gate, video_id,
      queued_at: queued.toISOString(),
      reviewer: pick(r, REVIEWERS),
      reviewed_at: reviewedAt.toISOString(),
      decision,
    });
  }
  return out;
}

// Stable per-UTC-day snapshot so repeated requests in the same day agree.
let cachedDay: number | null = null;
let cached: HitlItem[] = [];
function snapshot(): HitlItem[] {
  const now = new Date();
  const day = dayOfYearUtc(now);
  if (cachedDay !== day) { cached = generateItems(now); cachedDay = day; }
  return cached;
}

export function getHitlQueue(): HitlItem[] {
  return snapshot()
    .filter((i) => i.decision === "pending")
    .sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

function reviewMin(it: HitlItem): number | null {
  if (!it.reviewed_at) return null;
  const a = Date.parse(it.queued_at), b = Date.parse(it.reviewed_at);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 60_000) : null;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeHitlBurden() {
  const items = snapshot();
  const reviewed = items.filter((i) => i.reviewed_at !== null);
  const pending = items.filter((i) => i.decision === "pending");
  const allMins = reviewed.map(reviewMin).filter((n): n is number => n !== null);

  const by_gate = GATES.map((g) => {
    const gi = items.filter((i) => i.gate === g);
    const gr = gi.filter((i) => i.reviewed_at !== null);
    const mins = gr.map(reviewMin).filter((n): n is number => n !== null);
    return {
      gate: g,
      label: GATE_LABELS[g],
      pending: gi.filter((i) => i.decision === "pending").length,
      reviewed: gr.length,
      avg_review_minutes: avg(mins),
    };
  });
  const bottleneckSrc = by_gate
    .filter((g) => g.avg_review_minutes !== null)
    .sort((a, b) => (b.avg_review_minutes ?? 0) - (a.avg_review_minutes ?? 0))[0];
  const bottleneck = bottleneckSrc
    ? { gate: bottleneckSrc.gate, label: bottleneckSrc.label, avg_review_minutes: bottleneckSrc.avg_review_minutes ?? 0 }
    : null;

  const revMap = new Map<string, number[]>();
  for (const it of reviewed) {
    const m = reviewMin(it);
    if (!it.reviewer || m === null) continue;
    (revMap.get(it.reviewer) ?? revMap.set(it.reviewer, []).get(it.reviewer)!).push(m);
  }
  const by_reviewer = Array.from(revMap.entries())
    .map(([reviewer, m]) => ({ reviewer, reviewed: m.length, avg_review_minutes: avg(m) }))
    .sort((a, b) => b.reviewed - a.reviewed);

  // Heatmap: every item bucketed by (UTC day-of-week, UTC hour-of-day).
  const bucket = new Map<string, number>();
  for (const it of items) {
    const d = new Date(it.queued_at);
    const k = `${d.getUTCDay()}-${d.getUTCHours()}`;
    bucket.set(k, (bucket.get(k) ?? 0) + 1);
  }
  const heatmap: { dow: number; hour: number; count: number }[] = [];
  for (let dow = 0; dow < 7; dow++)
    for (let hour = 0; hour < 24; hour++)
      heatmap.push({ dow, hour, count: bucket.get(`${dow}-${hour}`) ?? 0 });

  // Auto-passed = approved within 2 minutes (gate effectively rubber-stamped).
  const auto = reviewed.filter((i) => {
    const m = reviewMin(i);
    return i.decision === "approved" && m !== null && m <= 2;
  }).length;

  return {
    fetched_at: new Date().toISOString(),
    queue_depth: pending.length,
    reviewed: reviewed.length,
    avg_review_minutes: avg(allMins),
    auto_passed_pct: reviewed.length ? auto / reviewed.length : null,
    bottleneck,
    by_gate,
    by_reviewer,
    heatmap,
  };
}
