import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { cn } from "@/lib/utils";
import { Workflow, AlertCircle } from "lucide-react";

type ScriptSageStats = {
  scripts_generated_24h: number;
  scripts_generated_7d: number;
  videos_generated_24h: number;
  videos_generated_7d: number;
  fallback_rate_24h: number;
  error_rate_24h: number;
  status_sync_lag_seconds: number;
};

type JobStatus = {
  job: string;
  last_run_at: string | null;
  last_status: "ok" | "error" | "stalled" | "unknown";
  last_error: string | null;
};

type ScriptSageResponse = {
  scriptsage_configured: boolean;
  stats: ScriptSageStats | null;
  jobs: JobStatus[] | null;
  fetched_at: string;
};

// "—" placeholder for any null/undefined numeric/string scalar.
function fmtNum(v: number | null | undefined, opts?: { pct?: boolean; suffix?: string; digits?: number }) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const digits = opts?.digits ?? (opts?.pct ? 1 : 0);
  if (opts?.pct) return `${(v * 100).toFixed(digits)}%`;
  const s = v.toLocaleString(undefined, { maximumFractionDigits: digits });
  return opts?.suffix ? `${s}${opts.suffix}` : s;
}

function fmtDate(v: string | null) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return v;
  }
}

const STATUS_COLORS: Record<JobStatus["last_status"], string> = {
  ok: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  error: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  stalled: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  unknown: "bg-muted text-muted-foreground border-card-border",
};

export default function ScriptSage() {
  const { data, isLoading, isError, error, refetch } = useQuery<ScriptSageResponse>({
    queryKey: ["/api/content-platform/scriptsage"],
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <Layout
        title="ScriptSage Throughput"
        subtitle="Live throughput, fallback/error rates, status-sync lag, and background-job health for the scriptsage-backend service."
      >
        <Skeleton lines={6} />
      </Layout>
    );
  }

  // Distinguish a real fetch failure (network/5xx) from the upstream
  // explicitly reporting that ScriptSage isn't configured. Bugbot flagged
  // that collapsing these to one empty-state hides errors.
  if (isError || !data) {
    return (
      <Layout
        title="ScriptSage Throughput"
        subtitle="Live throughput, fallback/error rates, status-sync lag, and background-job health for the scriptsage-backend service."
      >
        <ErrorState
          title="Failed to load ScriptSage status"
          error={error ?? new Error("The /api/content-platform/scriptsage request failed.")}
          onRetry={() => refetch()}
        />
      </Layout>
    );
  }

  const configured = data.scriptsage_configured;
  const stats = data.stats;
  const jobs = data.jobs;

  return (
    <Layout
      title="ScriptSage Throughput"
      subtitle="Live throughput, fallback/error rates, status-sync lag, and background-job health for the scriptsage-backend service."
    >
      {!configured ? (
        <EmptyState
          title="ScriptSage not configured"
          description={
            <>
              Set <code className="font-mono">SCRIPTSAGE_API_BASE</code> (and optionally{" "}
              <code className="font-mono">SCRIPTSAGE_API_TOKEN</code>) to populate this section.
            </>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <Stat label="Scripts / 24h" value={fmtNum(stats?.scripts_generated_24h)} />
            <Stat label="Scripts / 7d" value={fmtNum(stats?.scripts_generated_7d)} />
            <Stat label="Videos / 24h" value={fmtNum(stats?.videos_generated_24h)} />
            <Stat label="Videos / 7d" value={fmtNum(stats?.videos_generated_7d)} />
            <Stat
              label="Fallback rate"
              value={fmtNum(stats?.fallback_rate_24h, { pct: true })}
              tone={
                stats?.fallback_rate_24h !== undefined && stats?.fallback_rate_24h !== null && stats.fallback_rate_24h > 0.1
                  ? "warn"
                  : undefined
              }
              sub="24h"
            />
            <Stat
              label="Error rate"
              value={fmtNum(stats?.error_rate_24h, { pct: true })}
              tone={
                stats?.error_rate_24h !== undefined && stats?.error_rate_24h !== null && stats.error_rate_24h > 0.05
                  ? "bad"
                  : undefined
              }
              sub="24h"
            />
            <Stat
              label="Status-sync lag"
              value={fmtNum(stats?.status_sync_lag_seconds, { suffix: "s" })}
              tone={
                stats?.status_sync_lag_seconds !== undefined && stats?.status_sync_lag_seconds !== null && stats.status_sync_lag_seconds > 120
                  ? "warn"
                  : undefined
              }
            />
          </div>

          <section>
            <h3 className="font-semibold text-sm flex items-center gap-2 mb-3">
              <Workflow className="h-4 w-4" /> Background jobs
              <span className="text-xs text-muted-foreground font-normal">({jobs?.length ?? 0})</span>
            </h3>
            {!jobs || jobs.length === 0 ? (
              <div className="rounded-lg border border-card-border bg-card p-6 text-center">
                <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                <div className="text-xs text-muted-foreground">No job status available</div>
              </div>
            ) : (
              <div className="rounded-lg border border-card-border bg-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Job</th>
                      <th className="text-left px-4 py-2 font-medium">Last run</th>
                      <th className="text-left px-4 py-2 font-medium">Status</th>
                      <th className="text-left px-4 py-2 font-medium">Last error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((j) => (
                      <tr key={j.job} className="border-t border-card-border">
                        <td className="px-4 py-2 font-mono text-xs">{j.job}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{fmtDate(j.last_run_at)}</td>
                        <td className="px-4 py-2">
                          <span
                            className={cn(
                              "text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border",
                              STATUS_COLORS[j.last_status] ?? STATUS_COLORS.unknown,
                            )}
                          >
                            {j.last_status}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs font-mono text-rose-700 dark:text-rose-400 max-w-md truncate">
                          {j.last_error ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Layout>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const ring =
    tone === "good"
      ? "border-emerald-500/40"
      : tone === "warn"
        ? "border-amber-500/40"
        : tone === "bad"
          ? "border-rose-500/40"
          : "border-card-border";
  return (
    <div className={cn("rounded-lg border bg-card p-4", ring)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
