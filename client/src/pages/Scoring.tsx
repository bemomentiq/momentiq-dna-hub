import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { cn } from "@/lib/utils";

type Dimension =
  | "naturalness"
  | "fidelity"
  | "commerce"
  | "diversity"
  | "safety"
  | "overall";

type IdsDistribution = {
  dimension: Dimension;
  median: number | null;
  p25: number | null;
  p75: number | null;
  n: number | null;
};

type IdsResponse = {
  dna_configured: boolean;
  distributions: IdsDistribution[] | null;
  window_days: number;
  fetched_at: string;
};

const DIMENSION_ORDER: Dimension[] = [
  "naturalness",
  "fidelity",
  "commerce",
  "diversity",
  "safety",
];

const DIMENSION_BLURB: Record<Dimension, string> = {
  naturalness: "Does it feel like a real human creator?",
  fidelity: "Faithful to the product + claims?",
  commerce: "TikTok Shop intent + CTA strength.",
  diversity: "Variation across hooks, angles, scenes.",
  safety: "Policy + brand-safety guardrails.",
  overall: "Composite indistinguishability score.",
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

function toneFor(median: number | null | undefined): "good" | "warn" | "bad" | "muted" {
  if (median === null || median === undefined || Number.isNaN(median)) return "muted";
  if (median >= 0.85) return "good";
  if (median >= 0.7) return "warn";
  return "bad";
}

function Badge({ tone }: { tone: "good" | "warn" | "bad" | "muted" }) {
  const map = {
    good: "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400",
    warn: "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400",
    bad: "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400",
    muted: "bg-muted/30 border-border text-muted-foreground",
  } as const;
  const label = {
    good: "≥ 0.85 pass",
    warn: "0.70–0.84",
    bad: "< 0.70 fail",
    muted: "no data",
  }[tone];
  return (
    <span className={cn("text-[11px] px-1.5 py-0.5 rounded border whitespace-nowrap", map[tone])}>
      {label}
    </span>
  );
}

export default function Scoring() {
  const { data, isLoading, isError, error, refetch } = useQuery<IdsResponse>({
    queryKey: ["/api/content-platform/ids-distribution?window_days=7"],
  });

  if (isLoading) {
    return (
      <Layout title="IDS Scoring" subtitle="Indistinguishability score distribution (7-day window).">
        <Skeleton lines={6} />
      </Layout>
    );
  }

  // Distinguish a real fetch failure (network/5xx) from the upstream
  // explicitly reporting that DNA isn't configured. Bugbot flagged that
  // collapsing these to one empty-state hides errors.
  if (isError || !data) {
    return (
      <Layout title="IDS Scoring" subtitle="Indistinguishability score distribution (7-day window).">
        <ErrorState
          title="Failed to load IDS distribution"
          error={error ?? new Error("The /api/content-platform/ids-distribution request failed.")}
          onRetry={() => refetch()}
        />
      </Layout>
    );
  }

  if (!data.dna_configured) {
    return (
      <Layout
        title="IDS Scoring"
        subtitle="Indistinguishability score distribution (7-day window)."
      >
        <EmptyState
          title="DNA service not configured"
          description={
            <>
              Set <code className="font-mono">DNA_API_BASE</code> to populate IDS scoring. Promotion criterion is
              indistinguishability ≥ 0.85 across all 5 dimensions for TikTok Shop creatives.
            </>
          }
        />
      </Layout>
    );
  }

  const dists = data.distributions ?? [];
  const byDim = new Map<Dimension, IdsDistribution>();
  dists.forEach((d) => byDim.set(d.dimension, d));
  const overall = byDim.get("overall") ?? null;

  return (
    <Layout
      title="IDS Scoring"
      subtitle={`5-dimension indistinguishability — last ${data.window_days} days. Promotion gate: median ≥ 0.85.`}
    >
      {/* Overall hero */}
      <section
        className={cn(
          "rounded-lg border bg-card p-6 mb-6",
          toneFor(overall?.median) === "good"
            ? "border-emerald-500/40"
            : toneFor(overall?.median) === "warn"
            ? "border-amber-500/40"
            : toneFor(overall?.median) === "bad"
            ? "border-rose-500/40"
            : "border-card-border",
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Overall IDS (composite)</div>
            <div className="mt-1 flex items-baseline gap-3">
              <div className="text-5xl font-semibold tabular-nums">{fmt(overall?.median ?? null)}</div>
              <Badge tone={toneFor(overall?.median)} />
            </div>
            <p className="text-xs text-muted-foreground mt-2">{DIMENSION_BLURB.overall}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground space-y-1">
            <div>p25 <span className="tabular-nums text-foreground">{fmt(overall?.p25 ?? null)}</span></div>
            <div>p75 <span className="tabular-nums text-foreground">{fmt(overall?.p75 ?? null)}</span></div>
            <div>n = <span className="tabular-nums text-foreground">{overall?.n ?? "—"}</span></div>
          </div>
        </div>
      </section>

      {/* 5-dimension grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {DIMENSION_ORDER.map((dim) => {
          const d = byDim.get(dim) ?? null;
          const tone = toneFor(d?.median);
          return (
            <div
              key={dim}
              className={cn(
                "rounded-lg border bg-card p-4",
                tone === "good"
                  ? "border-emerald-500/40"
                  : tone === "warn"
                  ? "border-amber-500/40"
                  : tone === "bad"
                  ? "border-rose-500/40"
                  : "border-card-border",
              )}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-muted-foreground capitalize">{dim}</div>
                <Badge tone={tone} />
              </div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{fmt(d?.median ?? null)}</div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>p25 <span className="tabular-nums text-foreground">{fmt(d?.p25 ?? null)}</span></span>
                <span>p75 <span className="tabular-nums text-foreground">{fmt(d?.p75 ?? null)}</span></span>
                <span>n = <span className="tabular-nums text-foreground">{d?.n ?? "—"}</span></span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2 leading-snug">{DIMENSION_BLURB[dim]}</p>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground mt-6">
        Color thresholds: green ≥ 0.85 · amber 0.70–0.84 · red &lt; 0.70. Veo 3.1 prompt chain; TikTok Shop only.
      </p>
    </Layout>
  );
}
