import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, Clock, ExternalLink, Layers, Timer } from "lucide-react";

type StageFailure = {
  run_id: string | null;
  action_name: string;
  error_message: string | null;
  failed_at: string;
};

type Stage = {
  stage_id: string;
  label: string;
  description: string;
  focus_area: string | null;
  logs_query: string;
  throughput_24h: number;
  success_pct: number | null;
  p95_ms: number | null;
  errors_24h: number;
  last_run_at: string | null;
  recent_failures: StageFailure[];
};

type StagesResponse = {
  neon_configured: boolean;
  neon_error: string | null;
  stages: Stage[];
  fetched_at: string;
};

function fmtMs(n: number | null): string {
  if (n == null) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}
function fmtPct(n: number | null): string {
  return n == null ? "—" : `${n.toFixed(1)}%`;
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 0) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function tonesFor(pct: number | null, errors: number) {
  const t = pct == null ? "neutral" : pct >= 99 && errors === 0 ? "good" : pct >= 95 ? "warn" : "bad";
  return {
    tone: t,
    border: { good: "border-emerald-500/30", warn: "border-amber-500/30", bad: "border-rose-500/40", neutral: "border-card-border" }[t],
    bar: { good: "bg-emerald-500/70", warn: "bg-amber-500/70", bad: "bg-rose-500/70", neutral: "bg-primary/40" }[t],
    badge: {
      good: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
      warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
      bad: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
      neutral: "bg-muted text-muted-foreground border-card-border",
    }[t],
  };
}

function StageCard({ stage, maxThroughput, onPickFailure }: { stage: Stage; maxThroughput: number; onPickFailure: (s: Stage) => void }) {
  const t = tonesFor(stage.success_pct, stage.errors_24h);
  const Icon = t.tone === "good" ? CheckCircle2 : t.tone === "bad" ? AlertTriangle : Activity;
  const barPct = maxThroughput === 0 ? 0 : Math.max(2, Math.round((stage.throughput_24h / maxThroughput) * 100));
  const cold = stage.throughput_24h === 0;
  const stats: Array<[typeof Layers, string, string]> = [
    [Layers, "Throughput 24h", stage.throughput_24h.toLocaleString()],
    [Timer, "P95", fmtMs(stage.p95_ms)],
    [AlertTriangle, "Errors 24h", stage.errors_24h.toLocaleString()],
    [Clock, "Last run", fmtRelative(stage.last_run_at)],
  ];
  return (
    <article className={cn("rounded-lg border bg-card p-4 sm:p-5", t.border)} data-testid={`stage-${stage.stage_id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">{stage.label}</h3>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{stage.description}</p>
        </div>
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", t.badge)}>
          <Icon className="h-3 w-3" aria-hidden="true" />
          {fmtPct(stage.success_pct)}
        </span>
      </div>
      <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full transition-all", t.bar)} style={{ width: `${barPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 text-xs">
        {stats.map(([I, label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground inline-flex items-center gap-1">
              <I className="h-3 w-3" aria-hidden="true" /> {label}
            </dt>
            <dd className="font-medium tabular-nums mt-0.5" title={label === "Last run" ? stage.last_run_at ?? "" : undefined}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex items-center justify-between gap-3">
        <a
          href={`#/fleet?q=${encodeURIComponent(stage.logs_query)}`}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
          data-testid={`logs-link-${stage.stage_id}`}
        >
          Jump to logs <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
        {stage.recent_failures.length > 0 ? (
          <button
            type="button"
            onClick={() => onPickFailure(stage)}
            className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-card-border hover:bg-muted"
            data-testid={`failures-${stage.stage_id}`}
          >
            {stage.recent_failures.length} recent {stage.recent_failures.length === 1 ? "failure" : "failures"}
            <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : cold ? (
          <span className="text-xs text-muted-foreground italic">cold · no runs in 24h</span>
        ) : (
          <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> no recent failures
          </span>
        )}
      </div>
    </article>
  );
}

function FailureDrawer({ stage, onClose }: { stage: Stage | null; onClose: () => void }) {
  return (
    <Sheet open={stage != null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{stage?.label ?? "Recent failures"}</SheetTitle>
          <SheetDescription>Last {stage?.recent_failures.length ?? 0} error rows from the past 24h.</SheetDescription>
        </SheetHeader>
        <ol className="mt-4 space-y-3" data-testid="failure-list">
          {(stage?.recent_failures ?? []).map((f, i) => (
            <li key={`${f.run_id ?? "no-run"}-${i}`} className="rounded-md border border-card-border bg-card/60 p-3">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-mono truncate" title={f.action_name}>{f.action_name}</span>
                <span className="text-muted-foreground tabular-nums whitespace-nowrap">{fmtRelative(f.failed_at)}</span>
              </div>
              {f.error_message && (
                <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-rose-600 dark:text-rose-400 font-mono leading-snug">{f.error_message}</pre>
              )}
              {f.run_id && (
                <a
                  href={`#/run?id=${encodeURIComponent(f.run_id)}`}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  data-testid={`failure-run-link-${i}`}
                >
                  run {f.run_id} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </li>
          ))}
        </ol>
      </SheetContent>
    </Sheet>
  );
}

export default function DataPipeline() {
  const [picked, setPicked] = useState<Stage | null>(null);
  const { data, isLoading, isError, error, refetch } = useQuery<StagesResponse>({
    queryKey: ["/api/data-pipeline/stages"],
    refetchInterval: 30_000,
  });
  const maxThroughput = useMemo(
    () => (data?.stages?.length ? Math.max(0, ...data.stages.map((s) => s.throughput_24h)) : 0),
    [data],
  );

  return (
    <Layout
      title="DNA Data Pipeline"
      subtitle="Kalodata → Gemini Vision → DNA-knob → engine dispatch → post-proc → IDS scoring → LoRA drift. Live rollups from cos_runs."
    >
      {isLoading ? (
        <Skeleton lines={8} />
      ) : isError || !data ? (
        <ErrorState
          title="Failed to load pipeline stages"
          error={error ?? new Error("The /api/data-pipeline/stages request failed.")}
          onRetry={() => refetch()}
        />
      ) : (
        <>
          {!data.neon_configured && (
            <div className="mb-4">
              <EmptyState
                title="Neon telemetry not reachable"
                description={
                  <>
                    Set <code className="font-mono">NEON_READ_URL</code> to populate live stage rollups.
                    {data.neon_error ? ` (${data.neon_error})` : null}
                  </>
                }
              />
            </div>
          )}
          {data.stages.length === 0 ? (
            <EmptyState title="No stages configured" />
          ) : (
            <ol className="space-y-3" data-testid="pipeline-stages">
              {data.stages.map((s, idx) => (
                <li key={s.stage_id} className="relative">
                  {idx < data.stages.length - 1 && (
                    <span className="absolute left-3 top-full h-3 w-px bg-border" aria-hidden="true" />
                  )}
                  <div className="flex gap-3">
                    <div
                      className="shrink-0 h-6 w-6 rounded-full border bg-card flex items-center justify-center text-[11px] font-semibold tabular-nums text-muted-foreground mt-3"
                      aria-hidden="true"
                    >
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <StageCard stage={s} maxThroughput={maxThroughput} onPickFailure={setPicked} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <FailureDrawer stage={picked} onClose={() => setPicked(null)} />
    </Layout>
  );
}
