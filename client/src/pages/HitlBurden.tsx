import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { StatCard } from "@/components/StatCard";
import { Heatmap, type HeatmapCell } from "@/components/Heatmap";
import { DataTable, type Column } from "@/components/data-table";

type HitlGate = "dr" | "ips" | "rai" | "brand_safety";

type HitlItem = {
  id: string;
  gate: HitlGate;
  video_id: string;
  queued_at: string;
  reviewer: string | null;
  reviewed_at: string | null;
  decision: "approved" | "rejected" | "softened" | "pending";
};

type GateStat = { gate: HitlGate; label: string; pending: number; reviewed: number; avg_review_minutes: number | null };
type ReviewerStat = { reviewer: string; reviewed: number; avg_review_minutes: number | null };

type HitlBurden = {
  queue_depth: number;
  reviewed: number;
  avg_review_minutes: number | null;
  auto_passed_pct: number | null;
  bottleneck: { gate: HitlGate; label: string; avg_review_minutes: number } | null;
  by_gate: GateStat[];
  by_reviewer: ReviewerStat[];
  heatmap: { dow: number; hour: number; count: number }[];
};

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const GATE_LABEL: Record<HitlGate, string> = {
  dr: "DR lint", ips: "IPS lint", rai: "RAI softener", brand_safety: "Brand safety",
};

function fmtMins(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (v < 1) return "<1m";
  return v < 60 ? `${v.toFixed(1)}m` : `${(v / 60).toFixed(1)}h`;
}
function fmtPct(v: number | null | undefined): string {
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(1)}%`;
}
function ageMin(queuedAt: string): number {
  const t = Date.parse(queuedAt);
  return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 60_000) : 0;
}

const queueColumns: Column<HitlItem>[] = [
  { key: "gate", header: "Gate", accessor: (r) => r.gate, render: (r) => <span>{GATE_LABEL[r.gate]}</span> },
  {
    key: "video_id", header: "Video", accessor: (r) => r.video_id,
    render: (r) => <span className="font-mono text-[11px]">{r.video_id}</span>,
  },
  {
    key: "queued_at", header: "Queued", accessor: (r) => r.queued_at,
    render: (r) => <span className="text-xs text-muted-foreground">{new Date(r.queued_at).toLocaleString()}</span>,
  },
  {
    key: "age", header: "Age", accessor: (r) => ageMin(r.queued_at), align: "right",
    render: (r) => <span className="tabular-nums">{fmtMins(ageMin(r.queued_at))}</span>,
  },
];

const reviewerColumns: Column<ReviewerStat>[] = [
  { key: "reviewer", header: "Reviewer", accessor: (r) => r.reviewer },
  {
    key: "reviewed", header: "Reviewed", accessor: (r) => r.reviewed, align: "right",
    render: (r) => <span className="tabular-nums">{r.reviewed.toLocaleString()}</span>,
  },
  {
    key: "avg_review_minutes", header: "Avg time",
    accessor: (r) => r.avg_review_minutes ?? 0, align: "right",
    render: (r) => <span className="tabular-nums">{fmtMins(r.avg_review_minutes)}</span>,
  },
];

export default function HitlBurden() {
  const burdenQ = useQuery<HitlBurden>({ queryKey: ["/api/hitl/burden"] });
  const queueQ = useQuery<{ items: HitlItem[] }>({ queryKey: ["/api/hitl/queue"] });

  const subtitle = "DR/IPS lints + RAI softener + brand-safety review queue.";

  if ((burdenQ.isLoading || queueQ.isLoading) && !burdenQ.data && !queueQ.data) {
    return <Layout title="HITL Burden" subtitle={subtitle}><Skeleton lines={6} /></Layout>;
  }
  if (burdenQ.isError || queueQ.isError) {
    return (
      <Layout title="HITL Burden" subtitle={subtitle}>
        <ErrorState
          title="Failed to load HITL data"
          error={burdenQ.error ?? queueQ.error ?? new Error("HITL endpoints unavailable")}
          onRetry={() => { burdenQ.refetch(); queueQ.refetch(); }}
        />
      </Layout>
    );
  }

  const burden = burdenQ.data;
  const queue = queueQ.data?.items ?? [];

  if (!burden || (burden.queue_depth === 0 && burden.reviewed === 0)) {
    return (
      <Layout title="HITL Burden" subtitle={subtitle}>
        <EmptyState
          title="No HITL activity"
          description="No items have been queued for human review yet. Items appear here when DR, IPS, RAI, or brand-safety gates flag a video."
        />
      </Layout>
    );
  }

  const cells: HeatmapCell[] = burden.heatmap.map((c) => ({
    x: String(c.hour).padStart(2, "0"),
    y: DOW[c.dow] ?? String(c.dow),
    value: c.count,
    label: `${DOW[c.dow]} ${String(c.hour).padStart(2, "0")}:00 UTC — ${c.count} item${c.count === 1 ? "" : "s"}`,
  }));

  return (
    <Layout title="HITL Burden" subtitle={subtitle}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Queue depth"
          value={burden.queue_depth.toLocaleString()}
          sub={`${burden.reviewed.toLocaleString()} reviewed total`}
          tone={burden.queue_depth > 20 ? "warn" : "default"}
        />
        <StatCard label="Avg review time" value={fmtMins(burden.avg_review_minutes)} />
        <StatCard
          label="Top bottleneck"
          value={burden.bottleneck?.label ?? "—"}
          sub={burden.bottleneck ? `${fmtMins(burden.bottleneck.avg_review_minutes)} avg` : undefined}
          tone={burden.bottleneck ? "bad" : "default"}
        />
        <StatCard label="Auto-passed" value={fmtPct(burden.auto_passed_pct)} sub="approved within 2 min" />
      </div>

      {burden.bottleneck && (
        <div className="mb-6 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm" data-testid="bottleneck-callout">
          <span className="font-medium text-rose-700 dark:text-rose-400">Bottleneck: {burden.bottleneck.label}</span>{" "}
          <span className="text-muted-foreground">
            averages {fmtMins(burden.bottleneck.avg_review_minutes)} per item — the slowest gate in the pipeline.
          </span>
        </div>
      )}

      <section className="rounded-lg border border-card-border bg-card p-5 mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
          Review burden by hour-of-day × day-of-week (UTC)
        </div>
        <div className="overflow-x-auto"><Heatmap cells={cells} width={760} height={260} /></div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">By gate</h2>
          <div className="rounded-lg border border-card-border bg-card divide-y divide-card-border">
            {burden.by_gate.map((g) => (
              <div key={g.gate} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`gate-row-${g.gate}`}>
                <div>
                  <div className="text-sm font-medium">{g.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {g.pending.toLocaleString()} pending · {g.reviewed.toLocaleString()} reviewed
                  </div>
                </div>
                <div className="text-sm tabular-nums">{fmtMins(g.avg_review_minutes)}</div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Reviewer leaderboard</h2>
          <DataTable
            rows={burden.by_reviewer}
            columns={reviewerColumns}
            rowKey={(r) => r.reviewer}
            defaultSort={{ key: "reviewed", dir: "desc" }}
            csvFilename="hitl-reviewers"
            emptyMessage="No reviewers have processed items yet."
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">
          {queue.length.toLocaleString()} pending item{queue.length === 1 ? "" : "s"}
        </h2>
        <DataTable
          rows={queue}
          columns={queueColumns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/review/${r.id}`}
          defaultSort={{ key: "age", dir: "desc" }}
          csvFilename="hitl-queue"
          emptyMessage="Queue is empty — no items waiting on human review."
        />
      </section>
    </Layout>
  );
}
