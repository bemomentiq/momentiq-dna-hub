import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Activity, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

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

export default function AbRuns() {
  const [status, setStatus] = useState<StatusFilter>("running");
  const { data, isLoading } = useQuery<AbRunsResponse>({
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

      {!dnaConfigured ? (
        <section className="rounded-lg border border-card-border bg-card p-10 text-center">
          <Activity className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          <h3 className="font-semibold text-sm">A/B runs unavailable</h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            The momentiq-dna service is not configured for this environment. Set <code className="font-mono">DNA_API_BASE</code> on the hub server to view live A/B experiment data.
          </p>
        </section>
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
          <div className="rounded-lg border border-card-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-xs uppercase text-muted-foreground tracking-wide">
                <tr>
                  <th className="text-left px-4 py-2.5">Run</th>
                  <th className="text-left px-4 py-2.5">Theme</th>
                  <th className="text-left px-4 py-2.5">Status</th>
                  <th className="text-right px-4 py-2.5">Videos</th>
                  <th className="text-right px-4 py-2.5">IDS mean</th>
                  <th className="text-right px-4 py-2.5">Δ vs ctrl</th>
                  <th className="text-right px-4 py-2.5">Veo cost</th>
                  <th className="text-right px-4 py-2.5">ROI</th>
                  <th className="text-left px-4 py-2.5">Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const passes = passesPromotionGate(r);
                  return (
                    <tr
                      key={r.run_id}
                      className={cn(
                        "border-t border-card-border hover:bg-accent/30",
                        passes && "bg-emerald-500/5"
                      )}
                      data-testid={`row-run-${r.run_id}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-[11px]">{r.run_id}</td>
                      <td className="px-4 py-2.5">{r.theme}</td>
                      <td className="px-4 py-2.5">
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
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">
                        {r.videos_scored}/{r.videos_budget}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{fmtNum(r.ids_mean)}</td>
                      <td
                        className={cn(
                          "px-4 py-2.5 text-right tabular-nums text-xs",
                          r.delta_vs_control != null && r.delta_vs_control >= 0.1 && "text-emerald-700 dark:text-emerald-400",
                          r.delta_vs_control != null && r.delta_vs_control < 0 && "text-rose-700 dark:text-rose-400"
                        )}
                      >
                        {r.delta_vs_control == null ? "—" : (r.delta_vs_control >= 0 ? "+" : "") + r.delta_vs_control.toFixed(2)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{fmtUsd(r.veo_cost_usd)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-xs">{fmtUsd(r.roi_usd)}</td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{fmtDate(r.started_at)}</td>
                    </tr>
                  );
                })}
                {runs.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-xs">
                      No {status} A/B runs.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </Layout>
  );
}
