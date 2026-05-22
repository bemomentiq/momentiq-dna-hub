import { useQuery } from "@tanstack/react-query";
import { useUrlState } from "@/hooks/useUrlState";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { DataTable, type Column } from "@/components/data-table";

// Mirrors server/clients/dna.ts AbRun shape — values from upstream may be null
// (run still in progress or cost not yet attributed) so columns render "—".
type AbRun = {
  run_id: string;
  theme: string;
  status: "running" | "completed" | "promoted" | "rejected";
  videos_scored: number;
  videos_budget: number;
  ids_mean: number | null;
  delta_vs_control: number | null;
  veo_cost_usd: number | null;
  roi_usd: number | null;
  started_at: string;
  completed_at: string | null;
};

type AbRunsResponse = {
  dna_configured: boolean;
  runs: AbRun[] | null;
  fetched_at: string;
};

type StatusFilter = "running" | "completed" | "promoted" | "rejected";

const STATUS_TABS: { value: StatusFilter; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "promoted", label: "Promoted" },
  { value: "rejected", label: "Rejected" },
];

const STATUS_BADGE: Record<StatusFilter, string> = {
  running: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  completed: "bg-slate-500/15 text-slate-700 dark:text-slate-400",
  promoted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  rejected: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

// Promotion gate per dna-platform anchor: indistinguishability score ≥ 0.85
// AND delta vs control ≥ +0.10. Used to flag pass-rows with a green badge.
function passesPromotionGate(r: AbRun): boolean {
  return (r.ids_mean ?? 0) >= 0.85 && (r.delta_vs_control ?? 0) >= 0.1;
}

function fmtNum(v: number | null, digits = 2): string {
  return v == null ? "—" : v.toFixed(digits);
}

function fmtUsd(v: number | null): string {
  return v == null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString().slice(0, 10);
}

const columns: Column<AbRun>[] = [
  {
    key: "run_id",
    header: "Run",
    accessor: (r) => r.run_id,
    render: (r) => <span className="font-mono text-[11px]">{r.run_id}</span>,
  },
  {
    key: "theme",
    header: "Theme",
    accessor: (r) => r.theme,
  },
  {
    key: "status",
    header: "Status",
    accessor: (r) => r.status,
    render: (r) => {
      const passes = passesPromotionGate(r);
      return (
        <div className="flex items-center gap-1.5">
          <span className={cn("text-[11px] px-1.5 py-0.5 rounded", STATUS_BADGE[r.status])}>
            {r.status}
          </span>
          {passes && (
            <span
              className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
              title="Passes promotion gate (IDS ≥ 0.85 AND Δ ≥ 0.10)"
              data-testid={`badge-gate-${r.run_id}`}
            >
              <CheckCircle2 className="h-3 w-3" /> gate
            </span>
          )}
        </div>
      );
    },
  },
  {
    key: "videos",
    header: "Videos",
    accessor: (r) => r.videos_scored,
    align: "right",
    render: (r) => (
      <span className="tabular-nums text-xs">
        {r.videos_scored}/{r.videos_budget}
      </span>
    ),
  },
  {
    key: "ids_mean",
    header: "IDS mean",
    accessor: (r) => r.ids_mean,
    align: "right",
    render: (r) => <span className="tabular-nums text-xs">{fmtNum(r.ids_mean)}</span>,
  },
  {
    key: "delta_vs_control",
    header: "Δ vs ctrl",
    accessor: (r) => r.delta_vs_control,
    align: "right",
    render: (r) => (
      <span
        className={cn(
          "tabular-nums text-xs",
          r.delta_vs_control != null && r.delta_vs_control >= 0.1 && "text-emerald-700 dark:text-emerald-400",
          r.delta_vs_control != null && r.delta_vs_control < 0 && "text-rose-700 dark:text-rose-400"
        )}
      >
        {r.delta_vs_control == null
          ? "—"
          : (r.delta_vs_control >= 0 ? "+" : "") + r.delta_vs_control.toFixed(2)}
      </span>
    ),
  },
  {
    key: "veo_cost_usd",
    header: "Veo cost",
    accessor: (r) => r.veo_cost_usd,
    align: "right",
    render: (r) => <span className="tabular-nums text-xs">{fmtUsd(r.veo_cost_usd)}</span>,
  },
  {
    key: "roi_usd",
    header: "ROI",
    accessor: (r) => r.roi_usd,
    align: "right",
    render: (r) => <span className="tabular-nums text-xs">{fmtUsd(r.roi_usd)}</span>,
  },
  {
    key: "started_at",
    header: "Started",
    accessor: (r) => r.started_at,
    render: (r) => <span className="text-xs text-muted-foreground">{fmtDate(r.started_at)}</span>,
  },
];

export default function AbRuns() {
  const [status, setStatus] = useUrlState<StatusFilter>("status", "running");
  const { data, isLoading, isError, error, refetch } = useQuery<AbRunsResponse>({
    queryKey: [`/api/content-platform/ab-runs?status=${status}&limit=100`],
  });

  const dnaConfigured = data?.dna_configured ?? true;
  const runs = data?.runs ?? [];
  const promotedCount = runs.filter(passesPromotionGate).length;

  return (
    <Layout
      title="A/B Experiments"
      subtitle={`Indistinguishability A/B runs across themes · promotion gate IDS ≥ 0.85 AND Δ ≥ +0.10`}
    >
      <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)} className="mb-4">
        <TabsList>
          {STATUS_TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading && !data ? (
        <Skeleton lines={6} />
      ) : isError ? (
        <ErrorState title="Failed to load A/B runs" error={error} onRetry={() => refetch()} />
      ) : !dnaConfigured ? (
        <EmptyState
          title="A/B runs not configured"
          description={
            <>
              Set <code className="font-mono">DNA_API_BASE</code> to populate this section.
            </>
          }
        />
      ) : (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {isLoading ? "Loading…" : `${runs.length} run${runs.length === 1 ? "" : "s"}`}
              {promotedCount > 0 && (
                <span className="ml-2 text-emerald-700 dark:text-emerald-400">
                  · {promotedCount} passing promotion gate
                </span>
              )}
            </h2>
          </div>
          <DataTable
            rows={runs}
            columns={columns}
            rowKey={(r) => r.run_id}
            defaultSort={{ key: "started_at", dir: "desc" }}
            csvFilename="ab-runs"
            emptyMessage={`No ${status} A/B runs.`}
          />
        </section>
      )}
    </Layout>
  );
}
