import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { DataTable, type Column } from "@/components/data-table";
import { Heatmap, type HeatmapCell } from "@/components/Heatmap";
import { useUrlState } from "@/hooks/useUrlState";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, Timer, Layers, Clock, PauseCircle } from "lucide-react";

type GenerationFailure = {
  pipeline: string;
  category: string;
  error_signature: string;
  count_24h: number;
  count_7d: number;
  last_seen_at: string;
};

type ErrorSignature = {
  signature: string;
  count_24h: number;
  count_7d: number;
  trend_pct: number | null;
  sample_message: string;
};

type JobQueueHealth = {
  pending: number;
  processing: number;
  p50_latency_ms: number | null;
  p95_latency_ms: number | null;
  stalled_count: number;
  computed_at: string;
};

type FunnelStage = "submitted" | "started" | "succeeded" | "high_quality";
type PipelineFunnelStep = { stage: FunnelStage; count: number };
type PipelineFunnel = {
  pipeline: string;
  category: string;
  steps: PipelineFunnelStep[];
  window_days: number;
};

type QueueResp = { scriptsage_configured: boolean; queue: JobQueueHealth | null };
type FailuresResp = { scriptsage_configured: boolean; failures: GenerationFailure[] };
type ErrorsResp = {
  scriptsage_configured: boolean;
  signatures: ErrorSignature[];
  window_days: number;
};
type FunnelResp = {
  scriptsage_configured: boolean;
  funnels: PipelineFunnel[];
  window_days: number;
};

const WINDOW_OPTIONS = [7, 14, 30] as const;
const STAGE_ORDER: FunnelStage[] = ["submitted", "started", "succeeded", "high_quality"];

function fmtMs(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.round(n)}ms`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

const errorColumns: Column<ErrorSignature>[] = [
  {
    key: "signature",
    header: "Signature",
    accessor: (r) => r.signature,
    render: (r) => <span className="font-mono text-xs">{r.signature}</span>,
  },
  {
    key: "count_24h",
    header: "24h",
    accessor: (r) => r.count_24h,
    align: "right",
    render: (r) => <span className="tabular-nums">{r.count_24h.toLocaleString()}</span>,
  },
  {
    key: "count_7d",
    header: "7d",
    accessor: (r) => r.count_7d,
    align: "right",
    render: (r) => <span className="tabular-nums">{r.count_7d.toLocaleString()}</span>,
  },
  {
    key: "trend_pct",
    header: "Trend",
    accessor: (r) => r.trend_pct ?? 0,
    align: "right",
    render: (r) => {
      const v = r.trend_pct;
      if (v == null) return <span className="text-muted-foreground">—</span>;
      const up = v > 0;
      const flat = v === 0;
      const color = flat
        ? "text-muted-foreground"
        : up
        ? "text-rose-600"
        : "text-emerald-600";
      const arrow = flat ? "·" : up ? "▲" : "▼";
      return (
        <span className={cn("inline-flex items-center gap-0.5 tabular-nums", color)}>
          <span aria-hidden="true">{arrow}</span>
          <span>{fmtPct(v)}</span>
        </span>
      );
    },
  },
  {
    key: "sample_message",
    header: "Sample",
    accessor: (r) => r.sample_message,
    render: (r) => (
      <span className="text-xs text-muted-foreground line-clamp-1" title={r.sample_message}>
        {r.sample_message}
      </span>
    ),
  },
];

function FunnelBars({ funnels }: { funnels: PipelineFunnel[] }) {
  // Aggregate per pipeline×category, but if many, show a unified total too.
  const maxCount = Math.max(
    1,
    ...funnels.flatMap((f) => f.steps.map((s) => s.count)),
  );

  return (
    <div className="space-y-5">
      {funnels.map((f) => {
        const stepMap = new Map(f.steps.map((s) => [s.stage, s.count]));
        const subm = stepMap.get("submitted") ?? 0;
        return (
          <div key={`${f.pipeline}::${f.category}`} className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="font-medium">
                {f.pipeline}
                <span className="text-muted-foreground"> · {f.category}</span>
              </div>
              <div className="text-muted-foreground">{subm.toLocaleString()} submitted</div>
            </div>
            <div className="space-y-1.5">
              {STAGE_ORDER.map((stage, idx) => {
                const count = stepMap.get(stage) ?? 0;
                const width = Math.max(2, (count / maxCount) * 100);
                const prev = idx === 0 ? null : stepMap.get(STAGE_ORDER[idx - 1]) ?? 0;
                const conv =
                  prev && prev > 0 ? ((count / prev) * 100).toFixed(1) + "%" : null;
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <div className="w-28 text-xs text-muted-foreground capitalize">
                      {stage.replace("_", " ")}
                    </div>
                    <div className="flex-1 h-5 bg-muted/40 rounded-sm overflow-hidden relative">
                      <div
                        className={cn(
                          "h-full transition-all rounded-sm",
                          stage === "high_quality"
                            ? "bg-emerald-500/70"
                            : stage === "succeeded"
                            ? "bg-primary/70"
                            : "bg-primary/40",
                        )}
                        style={{ width: `${width}%` }}
                      />
                    </div>
                    <div className="w-20 text-xs tabular-nums text-right">
                      {count.toLocaleString()}
                    </div>
                    <div className="w-16 text-xs text-muted-foreground tabular-nums text-right">
                      {conv ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PipelineHealth() {
  const [windowStr, setWindowStr] = useUrlState<"7" | "14" | "30">("window", "7");
  const windowDays = Number(windowStr) as 7 | 14 | 30;
  const setWindowDays = (n: number) => setWindowStr(String(n) as "7" | "14" | "30");

  const queueQ = useQuery<QueueResp>({
    queryKey: ["/api/content-platform/scriptsage/queue-health"],
    queryFn: async () => {
      const r = await fetch("/api/content-platform/scriptsage/queue-health");
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const failuresQ = useQuery<FailuresResp>({
    queryKey: ["/api/content-platform/scriptsage/failures"],
    queryFn: async () => {
      const r = await fetch("/api/content-platform/scriptsage/failures");
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const errorsQ = useQuery<ErrorsResp>({
    queryKey: ["/api/content-platform/scriptsage/errors", windowDays],
    queryFn: async () => {
      const r = await fetch(
        `/api/content-platform/scriptsage/errors?window_days=${windowDays}`,
      );
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const funnelQ = useQuery<FunnelResp>({
    queryKey: ["/api/content-platform/scriptsage/funnel", windowDays],
    queryFn: async () => {
      const r = await fetch(
        `/api/content-platform/scriptsage/funnel?window_days=${windowDays}`,
      );
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const queue = queueQ.data?.queue ?? null;
  const failures = failuresQ.data?.failures ?? [];
  const signatures = errorsQ.data?.signatures ?? [];
  const funnels = funnelQ.data?.funnels ?? [];

  const errors24h = failures.reduce((acc, f) => acc + (f.count_24h || 0), 0);
  const ssConfigured =
    queueQ.data?.scriptsage_configured ??
    failuresQ.data?.scriptsage_configured ??
    errorsQ.data?.scriptsage_configured ??
    funnelQ.data?.scriptsage_configured ??
    false;

  const anyLoading =
    queueQ.isLoading || failuresQ.isLoading || errorsQ.isLoading || funnelQ.isLoading;
  const anyError = queueQ.isError || failuresQ.isError || errorsQ.isError || funnelQ.isError;

  const heatmapCells: HeatmapCell[] = (() => {
    const agg = new Map<string, { pipeline: string; category: string; count24h: number; count7d: number }>();
    for (const f of failures) {
      const key = `${f.pipeline}::${f.category}`;
      const prev = agg.get(key);
      if (prev) {
        prev.count24h += f.count_24h;
        prev.count7d += f.count_7d;
      } else {
        agg.set(key, { pipeline: f.pipeline, category: f.category, count24h: f.count_24h, count7d: f.count_7d });
      }
    }
    return Array.from(agg.values()).map((a) => ({
      x: a.category,
      y: a.pipeline,
      value: a.count24h,
      label: `${a.pipeline} · ${a.category}\n24h: ${a.count24h} · 7d: ${a.count7d}`,
    }));
  })();

  return (
    <Layout
      title="Pipeline Health"
      subtitle="ScriptSage generation funnel · errors · queue depth"
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Window
          </span>
          <div className="inline-flex rounded-md border border-card-border bg-card overflow-hidden">
            {WINDOW_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setWindowDays(opt)}
                data-testid={`window-${opt}`}
                className={cn(
                  "px-3 py-1.5 text-sm transition-colors",
                  windowDays === opt
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {opt}d
              </button>
            ))}
          </div>
        </div>
      }
    >
      {/* Stat row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          label="Pending"
          value={queue ? queue.pending.toLocaleString() : "—"}
          icon={<Layers className="h-4 w-4" />}
        />
        <StatCard
          label="Processing"
          value={queue ? queue.processing.toLocaleString() : "—"}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          label="p50 latency"
          value={queue ? fmtMs(queue.p50_latency_ms) : "—"}
          icon={<Timer className="h-4 w-4" />}
        />
        <StatCard
          label="p95 latency"
          value={queue ? fmtMs(queue.p95_latency_ms) : "—"}
          icon={<Clock className="h-4 w-4" />}
        />
        <StatCard
          label="Stalled"
          value={queue ? queue.stalled_count.toLocaleString() : "—"}
          tone={queue && queue.stalled_count > 0 ? "warn" : "default"}
          icon={<PauseCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Errors 24h"
          value={errors24h.toLocaleString()}
          tone={errors24h > 0 ? "warn" : "default"}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {anyLoading && !queueQ.data && !failuresQ.data && !errorsQ.data && !funnelQ.data ? (
        <Skeleton lines={8} />
      ) : anyError ? (
        <ErrorState
          title="Failed to load pipeline health"
          error={queueQ.error ?? failuresQ.error ?? errorsQ.error ?? funnelQ.error ?? new Error("ScriptSage monitoring endpoint failed.")}
          onRetry={() => {
            queueQ.refetch();
            failuresQ.refetch();
            errorsQ.refetch();
            funnelQ.refetch();
          }}
        />
      ) : !ssConfigured ? (
        <EmptyState
          title="ScriptSage not configured"
          description={
            <>
              Set <code className="font-mono">SCRIPTSAGE_API_BASE</code> to populate this page.
            </>
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Funnel card */}
          <section className="rounded-lg border border-card-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Generation funnel</h2>
                <p className="text-xs text-muted-foreground">
                  submitted → started → succeeded → high quality
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                {funnelQ.data?.window_days ?? windowDays}d window
              </div>
            </div>
            {funnels.length === 0 ? (
              <EmptyState
                title="No funnel data"
                description="No pipeline runs recorded in this window."
              />
            ) : (
              <FunnelBars funnels={funnels} />
            )}
          </section>

          {/* Error signatures table */}
          <section className="rounded-lg border border-card-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Error signatures</h2>
                <p className="text-xs text-muted-foreground">
                  Top recurring failure modes across the {errorsQ.data?.window_days ?? windowDays}d window.
                </p>
              </div>
            </div>
            <DataTable
              rows={signatures}
              columns={errorColumns}
              rowKey={(r) => r.signature}
              defaultSort={{ key: "count_24h", dir: "desc" }}
              csvFilename="error-signatures"
              emptyMessage="No error signatures in this window."
            />
          </section>

          {/* Heatmap card */}
          <section className="rounded-lg border border-card-border bg-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold">Generation failures · pipeline × category</h2>
                <p className="text-xs text-muted-foreground">
                  Cell value = 24h failure count.
                </p>
              </div>
            </div>
            {heatmapCells.length === 0 ? (
              <EmptyState
                title="No failures recorded"
                description="No generation failures in the last 24h."
              />
            ) : (
              <div className="overflow-x-auto">
                <Heatmap cells={heatmapCells} width={720} height={Math.max(200, 60 + 28 * new Set(failures.map((f) => f.pipeline)).size)} />
              </div>
            )}
          </section>
        </div>
      )}
    </Layout>
  );
}
