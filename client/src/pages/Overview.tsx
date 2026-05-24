import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { StatCard, ProgressBar } from "@/components/StatCard";
import { Skeleton, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Target,
  Activity,
  Trophy,
  DollarSign,
  AlertOctagon,
  PlayCircle,
  ExternalLink,
} from "lucide-react";

type DnaKpiSnapshot = {
  ids_convergence_pct: number | null;
  bandit_m11_progress: number | null;
  video_win_rate_24h: number | null;
  gmv_max_roas_7d: number | null;
  videos_24h: number | null;
  videos_ids_pass_24h: number | null;
  outbound_used_24h: number | null;
};

type RecentRun = {
  run_id: string;
  theme: string;
  status: string;
  ids_mean: number | null;
  started_at: string;
};

type DnaKpis = DnaKpiSnapshot & {
  dna_configured: boolean;
  neon_available: boolean;
  ids_target: number;
  prior_7d: DnaKpiSnapshot | null;
  recent_runs: RecentRun[];
  fetched_at: string;
};

type GhIssue = {
  number: number;
  title: string;
  html_url: string;
  repo: string;
  labels: string[];
  updated_at: string;
};
type GhIssuesResp = { issues: GhIssue[] };

const DASH = "—";

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString();
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const v = n <= 1 && n >= -1 ? n * 100 : n;
  return `${v.toFixed(digits)}%`;
}

function fmtRoas(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${n.toFixed(2)}×`;
}

function deltaPctPoints(
  cur: number | null | undefined,
  prior: number | null | undefined,
): number | null {
  if (cur == null || prior == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prior)) return null;
  const c = cur <= 1 && cur >= -1 ? cur * 100 : cur;
  const p = prior <= 1 && prior >= -1 ? prior * 100 : prior;
  return Math.round((c - p) * 10) / 10;
}

function deltaRatio(
  cur: number | null | undefined,
  prior: number | null | undefined,
): number | null {
  if (cur == null || prior == null) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prior) || prior === 0) return null;
  return Math.round(((cur - prior) / prior) * 1000) / 10;
}

function idsTone(pct: number | null): "good" | "warn" | "bad" | "default" {
  if (pct == null || !Number.isFinite(pct)) return "default";
  if (pct >= 100) return "good";
  if (pct >= 82) return "warn";
  return "bad";
}

function runStatusBadge(status: string) {
  const map: Record<string, string> = {
    promoted: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
    completed: "bg-sky-500/15 text-sky-500 border-sky-500/40",
    running: "bg-amber-500/15 text-amber-500 border-amber-500/40",
    rejected: "bg-rose-500/15 text-rose-500 border-rose-500/40",
  };
  return map[status] ?? "bg-muted text-muted-foreground border-card-border";
}

function NotConnected({ label }: { label: string }) {
  return (
    <span
      className="text-xs text-muted-foreground italic"
      data-testid={`not-connected-${label}`}
    >
      not connected
    </span>
  );
}

export default function Overview() {
  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<DnaKpis>({ queryKey: ["/api/overview/dna-kpis"] });

  const { data: blockersResp, isPending: blockersPending } = useQuery<GhIssuesResp>({
    queryKey: ["/api/gh-issues?state=open&labels=blocker"],
  });

  if (isLoading || !data) {
    return (
      <Layout title="DNA Pipeline Overview">
        <Skeleton lines={6} />
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout title="DNA Pipeline Overview">
        <ErrorState
          title="Failed to load DNA KPIs"
          error={error}
          onRetry={() => void refetch()}
        />
      </Layout>
    );
  }

  const idsT = idsTone(data.ids_convergence_pct);
  const idsDelta = deltaPctPoints(
    data.ids_convergence_pct,
    data.prior_7d?.ids_convergence_pct,
  );
  const roasDelta = deltaRatio(data.gmv_max_roas_7d, data.prior_7d?.gmv_max_roas_7d);
  const videosDelta = deltaRatio(data.videos_24h, data.prior_7d?.videos_24h);
  const idsPassDelta = deltaRatio(
    data.videos_ids_pass_24h,
    data.prior_7d?.videos_ids_pass_24h,
  );
  const outboundDelta = deltaRatio(
    data.outbound_used_24h,
    data.prior_7d?.outbound_used_24h,
  );

  const blockers = (blockersResp?.issues ?? [])
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);

  return (
    <Layout
      title="DNA Pipeline Overview"
      subtitle="IDS convergence · Bandit M11 · video win-rate · GMV Max ROAS"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="IDS Convergence"
          icon={<Target className="h-4 w-4" />}
          tone={idsT === "default" ? "default" : idsT}
          value={
            data.dna_configured ? (
              <span className="flex items-baseline gap-2">
                <span>{fmtPct(data.ids_convergence_pct, 0)}</span>
                <span className="text-xs text-muted-foreground">
                  of {data.ids_target.toFixed(2)} target
                </span>
              </span>
            ) : (
              <NotConnected label="ids-convergence" />
            )
          }
          sub={
            data.dna_configured ? (
              <ProgressBar
                value={data.ids_convergence_pct ?? 0}
                tone={idsT === "default" ? "primary" : idsT}
              />
            ) : (
              "DNA_API_BASE unset"
            )
          }
          delta={idsDelta != null ? { value: idsDelta, suffix: "pp" } : null}
        />

        <StatCard
          label="Bandit M11 Progress"
          icon={<Activity className="h-4 w-4" />}
          value={
            data.dna_configured ? (
              fmtPct(data.bandit_m11_progress, 0)
            ) : (
              <NotConnected label="bandit-m11" />
            )
          }
          sub={
            data.dna_configured ? (
              <ProgressBar value={data.bandit_m11_progress ?? 0} />
            ) : (
              "DNA_API_BASE unset"
            )
          }
        />

        <StatCard
          label="Video Win-Rate 24h"
          icon={<Trophy className="h-4 w-4" />}
          value={
            data.dna_configured ? (
              fmtPct(data.video_win_rate_24h)
            ) : (
              <NotConnected label="win-rate" />
            )
          }
          sub={
            data.dna_configured
              ? "Veo 3.1 Fast vs. baselines"
              : "DNA_API_BASE unset"
          }
        />

        <StatCard
          label="GMV Max ROAS 7d"
          icon={<DollarSign className="h-4 w-4" />}
          value={
            data.dna_configured ? (
              fmtRoas(data.gmv_max_roas_7d)
            ) : (
              <NotConnected label="gmv-roas" />
            )
          }
          sub={
            data.dna_configured
              ? data.neon_available
                ? "DNA-generated videos"
                : "DNA_NEON_READ_URL unset"
              : "DNA_API_BASE unset"
          }
          delta={roasDelta != null ? { value: roasDelta, suffix: "%" } : null}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <PlayCircle className="h-4 w-4 text-muted-foreground" />
              24h Pipeline Volume
              {!data.neon_available && (
                <Badge variant="outline" className="ml-1 text-[10px]">
                  Neon not connected
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <PipelineMetric
                label="Videos generated"
                value={fmtInt(data.videos_24h)}
                delta={videosDelta}
              />
              <PipelineMetric
                label="IDS-passing"
                value={fmtInt(data.videos_ids_pass_24h)}
                delta={idsPassDelta}
                sub={
                  data.videos_24h && data.videos_ids_pass_24h != null
                    ? `${Math.round(
                        (data.videos_ids_pass_24h / data.videos_24h) * 100,
                      )}% pass`
                    : undefined
                }
              />
              <PipelineMetric
                label="Outbound L0-L8"
                value={fmtInt(data.outbound_used_24h)}
                delta={outboundDelta}
                sub="active sales pipeline"
              />
            </div>

            <div className="mt-6">
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Recent A/B Runs
              </div>
              {data.recent_runs.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid="recent-runs-empty">
                  {DASH}{" "}
                  {data.dna_configured
                    ? "no active A/B runs"
                    : "DNA service not configured"}
                </p>
              ) : (
                <ul className="space-y-1.5" data-testid="recent-runs-list">
                  {data.recent_runs.map((r) => (
                    <li
                      key={r.run_id}
                      className="flex items-center justify-between gap-3 p-2 rounded-md border border-card-border text-sm"
                      data-testid={`recent-run-${r.run_id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-medium truncate">{r.theme || DASH}</div>
                        <div className="text-xs text-muted-foreground font-mono">
                          {r.run_id.slice(0, 8)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className="tabular-nums"
                        >
                          IDS {r.ids_mean != null ? r.ids_mean.toFixed(2) : DASH}
                        </Badge>
                        <Badge variant="outline" className={runStatusBadge(r.status)}>
                          {r.status}
                        </Badge>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-rose-500" />
              Blockers
              <Badge variant="secondary" className="ml-1">
                open · blocker
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {blockersPending ? (
              <Skeleton lines={3} />
            ) : blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="blockers-empty">
                {DASH} no open blockers across content repos.
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="blockers-list">
                {blockers.map((b) => (
                  <li
                    key={`${b.repo}-${b.number}`}
                    className="text-sm flex items-baseline gap-2"
                  >
                    <a
                      href={b.html_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-mono text-primary shrink-0 inline-flex items-center gap-1"
                    >
                      #{b.number} <ExternalLink className="h-3 w-3" />
                    </a>
                    <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                      {b.repo.split("/")[1]}
                    </span>
                    <span className="truncate">{b.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {!data.dna_configured && (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-muted-foreground">
          <div className="font-medium text-amber-500 mb-1">
            momentiq-dna not configured
          </div>
          <ul className="space-y-0.5">
            <li>
              · Set <code className="font-mono">DNA_API_BASE</code> to enable IDS,
              bandit, and A/B run KPIs.
            </li>
            <li>
              · Set <code className="font-mono">DNA_NEON_READ_URL</code> to enable
              24h pipeline volume + GMV Max ROAS.
            </li>
          </ul>
        </div>
      )}
    </Layout>
  );
}

function PipelineMetric({
  label,
  value,
  delta,
  sub,
}: {
  label: string;
  value: string;
  delta: number | null;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">
        {delta != null ? (
          <span
            className={
              delta > 0
                ? "text-emerald-600"
                : delta < 0
                ? "text-rose-600"
                : "text-muted-foreground"
            }
          >
            {delta > 0 ? "+" : ""}
            {delta}% vs prior 24h
          </span>
        ) : (
          (sub ?? DASH)
        )}
      </div>
    </div>
  );
}
