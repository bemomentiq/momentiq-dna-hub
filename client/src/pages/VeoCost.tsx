import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUrlState } from "@/hooks/useUrlState";
import { DataTable, type Column } from "@/components/data-table";

type VeoCallSummary = {
  theme: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_per_video: number;
  winning_videos: number;
  cost_per_winner: number | null;
  // Optional upstream-provided efficiency field; when absent we compute it
  // client-side using the IDS promotion gate (0.85) as the per-winner score floor.
  cost_per_ids_point?: number | null;
};

// $/IDS-point — cost efficiency normalised to the promotion gate. Returns null
// when we have no winners to amortise across (avoids divide-by-zero).
function computeCostPerIdsPoint(r: VeoCallSummary): number | null {
  if (r.cost_per_ids_point != null) return r.cost_per_ids_point;
  if (!r.winning_videos || r.winning_videos <= 0) return null;
  return r.total_cost_usd / (r.winning_videos * 0.85);
}

type VeoCostResponse = {
  dna_configured: boolean;
  upstream_error?: boolean;
  summary: VeoCallSummary[];
  total_cost_usd: number;
  window_days: number;
};

const WINDOW_OPTIONS = [7, 14, 30] as const;

function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const columns: Column<VeoCallSummary>[] = [
  {
    key: "theme",
    header: "Theme",
    accessor: (r) => r.theme,
    render: (r) => <span className="font-medium">{r.theme}</span>,
  },
  {
    key: "calls",
    header: "Calls",
    accessor: (r) => r.calls,
    align: "right",
    render: (r) => <span className="tabular-nums">{r.calls.toLocaleString()}</span>,
  },
  {
    key: "total_cost_usd",
    header: "Total cost",
    accessor: (r) => r.total_cost_usd,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtUsd(r.total_cost_usd)}</span>,
  },
  {
    key: "avg_cost_per_video",
    header: "Avg cost / video",
    accessor: (r) => r.avg_cost_per_video,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtUsd(r.avg_cost_per_video)}</span>,
  },
  {
    key: "winning_videos",
    header: "Winning videos",
    accessor: (r) => r.winning_videos,
    align: "right",
    render: (r) => <span className="tabular-nums">{r.winning_videos.toLocaleString()}</span>,
  },
  {
    key: "cost_per_ids_point",
    header: "$/IDS pt",
    accessor: (r) => computeCostPerIdsPoint(r),
    align: "right",
    render: (r) => (
      <span className="tabular-nums">{fmtUsd(computeCostPerIdsPoint(r))}</span>
    ),
  },
  {
    key: "cost_per_winner",
    header: "$/winner",
    accessor: (r) => r.cost_per_winner,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtUsd(r.cost_per_winner)}</span>,
  },
];

export default function VeoCost() {
  const [windowStr, setWindowStr] = useUrlState<"7" | "14" | "30">("window", "7");
  const windowDays = Number(windowStr) as 7 | 14 | 30;
  const setWindowDays = (n: number) => setWindowStr(String(n) as "7" | "14" | "30");
  const { data, isLoading, isError, error, refetch } = useQuery<VeoCostResponse>({
    queryKey: ["/api/content-platform/veo-cost", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/content-platform/veo-cost?window_days=${windowDays}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const rows = data?.summary ?? [];

  return (
    <Layout
      title="Veo Cost & ROI"
      subtitle="Veo 3.1 spend by theme, with cost-per-winning-video as the ROI signal."
    >
      <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
        <div className="rounded-lg border border-card-border bg-card p-5 flex-1 min-w-[260px]">
          <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Total Veo spend ({data?.window_days ?? windowDays}d)</span>
            <DollarSign className="h-4 w-4" />
          </div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">
            {data ? fmtUsd(data.total_cost_usd) : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Across {rows.length} {rows.length === 1 ? "theme" : "themes"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Window</span>
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
                    : "text-foreground hover:bg-muted"
                )}
              >
                {opt}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <Skeleton lines={6} />
      ) : isError || !data || data.upstream_error ? (
        // Distinguish a real fetch failure (network/5xx/upstream null) from
        // the upstream explicitly reporting that DNA isn't configured.
        // Bugbot flagged that collapsing these to one empty-state hides errors.
        <ErrorState
          title="Failed to load Veo cost"
          error={
            error ??
            new Error(
              data?.upstream_error
                ? "Upstream momentiq-dna request failed."
                : "The /api/content-platform/veo-cost request failed."
            )
          }
          onRetry={() => refetch()}
        />
      ) : data.dna_configured === false ? (
        <EmptyState
          title="DNA service not configured"
          description={
            <>
              Set <code className="font-mono">DNA_API_BASE</code> to populate this section.
            </>
          }
        />
      ) : (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(r) => r.theme}
          defaultSort={{ key: "total_cost_usd", dir: "desc" }}
          csvFilename="veo-cost"
          emptyMessage={`No Veo calls in the last ${data.window_days} days.`}
        />
      )}
    </Layout>
  );
}
