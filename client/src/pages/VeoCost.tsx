import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

type VeoCallSummary = {
  theme: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_per_video: number;
  winning_videos: number;
  cost_per_winner: number | null;
};

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

export default function VeoCost() {
  const [windowDays, setWindowDays] = useState<number>(7);
  const { data, isLoading, isError, error, refetch } = useQuery<VeoCostResponse>({
    queryKey: ["/api/content-platform/veo-cost", windowDays],
    queryFn: async () => {
      const r = await fetch(`/api/content-platform/veo-cost?window_days=${windowDays}`);
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      return r.json();
    },
  });

  const rows = (data?.summary ?? []).slice().sort((a, b) => b.total_cost_usd - a.total_cost_usd);

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
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-8 text-center text-sm text-muted-foreground">
          No Veo calls in the last {data.window_days} days.
        </div>
      ) : (
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Theme</th>
                  <th className="text-right px-4 py-2.5 font-medium">Calls</th>
                  <th className="text-right px-4 py-2.5 font-medium">Total cost</th>
                  <th className="text-right px-4 py-2.5 font-medium">Avg cost / video</th>
                  <th className="text-right px-4 py-2.5 font-medium">Winning videos</th>
                  <th className="text-right px-4 py-2.5 font-medium">Cost / winner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.theme}
                    className="border-t border-card-border hover:bg-muted/20"
                    data-testid={`veo-row-${row.theme}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{row.theme}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.calls.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtUsd(row.total_cost_usd)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtUsd(row.avg_cost_per_video)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{row.winning_videos.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtUsd(row.cost_per_winner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Layout>
  );
}
