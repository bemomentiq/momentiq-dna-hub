import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, ErrorState } from "@/components/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/StatCard";
import {
  TrendingUp,
  Sparkles,
  AlertOctagon,
  DollarSign,
  ExternalLink,
  Target,
  Activity,
  Trophy,
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

type DnaKpis = DnaKpiSnapshot & {
  dna_configured: boolean;
  neon_available: boolean;
  ids_target: number;
  prior_7d: DnaKpiSnapshot | null;
  recent_runs: Array<{
    run_id: string;
    theme: string;
    status: string;
    ids_mean: number | null;
    started_at: string;
  }>;
  fetched_at: string;
};

type VeoTheme = {
  theme: string;
  calls: number;
  total_cost_usd: number;
  avg_cost_per_video: number;
  winning_videos: number;
  cost_per_winner: number | null;
};

type Overview = {
  dna_configured: boolean;
  veo_spend_7d_usd: number | null;
  veo_themes_7d: VeoTheme[] | null;
};

type AbRun = {
  run_id: string;
  theme: string;
  status: string;
  videos_scored: number;
  videos_budget: number;
  ids_mean: number | null;
  delta_vs_control: number | null;
  veo_cost_usd: number | null;
  roi_usd: number | null;
  started_at: string;
  completed_at: string | null;
};

type PromotionResp = {
  dna_configured: boolean;
  candidates: AbRun[];
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
function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}pp`;
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

function trendWord(delta: number | null, opts: { invertGood?: boolean } = {}): string {
  if (delta == null) return "is flat WoW (no prior signal)";
  const goodPositive = !opts.invertGood;
  const direction =
    delta > 0
      ? goodPositive
        ? "up"
        : "up (negative)"
      : delta < 0
      ? goodPositive
        ? "down (negative)"
        : "down"
      : "flat";
  return `${direction} ${Math.abs(delta).toFixed(1)}${typeof delta === "number" ? "pp" : ""} WoW`;
}

function buildNarrative(data: DnaKpis): string[] {
  const lines: string[] = [];
  if (!data.dna_configured) {
    return [
      "momentiq-dna service is not reachable from this hub — DNA_API_BASE is unset. Configure it in /autonomy to begin reporting KPIs.",
    ];
  }
  const idsDelta = deltaPctPoints(
    data.ids_convergence_pct,
    data.prior_7d?.ids_convergence_pct,
  );
  if (data.ids_convergence_pct != null) {
    lines.push(
      `IDS overall is ${fmtPct(data.ids_convergence_pct, 0)} of the ${data.ids_target.toFixed(
        2,
      )} reference target${idsDelta != null ? ` — ${trendWord(idsDelta)}` : ""}.`,
    );
  }
  if (data.bandit_m11_progress != null) {
    lines.push(
      `Bandit M11 convergence sits at ${fmtPct(
        data.bandit_m11_progress,
        0,
      )} — the active focus mission (M11.2–11.4).`,
    );
  }
  if (data.video_win_rate_24h != null) {
    lines.push(
      `Veo 3.1 Fast is winning ${fmtPct(
        data.video_win_rate_24h,
      )} of recent head-to-head scores against baseline variants.`,
    );
  }
  const roasDelta = deltaRatio(data.gmv_max_roas_7d, data.prior_7d?.gmv_max_roas_7d);
  if (data.gmv_max_roas_7d != null) {
    lines.push(
      `GMV Max is returning ${fmtRoas(data.gmv_max_roas_7d)} on DNA-generated creative over the last 7 days${
        roasDelta != null ? ` (${roasDelta >= 0 ? "+" : ""}${roasDelta}% vs prior 7d)` : ""
      }.`,
    );
  } else if (data.dna_configured && !data.neon_available) {
    lines.push(
      "GMV Max ROAS is not visible — DNA_NEON_READ_URL is unset so the hub cannot read the gmv_max_metrics table.",
    );
  }
  const videosDelta = deltaRatio(data.videos_24h, data.prior_7d?.videos_24h);
  if (data.videos_24h != null && data.videos_ids_pass_24h != null) {
    const passPct = data.videos_24h
      ? Math.round((data.videos_ids_pass_24h / data.videos_24h) * 100)
      : null;
    lines.push(
      `Throughput: ${fmtInt(data.videos_24h)} videos generated in the last 24h, ${fmtInt(
        data.videos_ids_pass_24h,
      )} (${passPct}%) cleared the IDS gate${
        videosDelta != null ? ` — volume ${videosDelta >= 0 ? "+" : ""}${videosDelta}% vs prior 24h` : ""
      }.`,
    );
  }
  if (data.outbound_used_24h != null) {
    lines.push(
      `${fmtInt(
        data.outbound_used_24h,
      )} of those videos shipped into the active L0–L8 outbound pipeline.`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      "DNA service is reachable but returned no KPI signal yet — wait for the next 5-minute rollup or check upstream availability.",
    );
  }
  return lines;
}

export default function ExecutiveBrief() {
  const {
    data: kpis,
    isPending: kpisPending,
    isError: kpisIsError,
    error: kpisError,
  } = useQuery<DnaKpis>({ queryKey: ["/api/overview/dna-kpis"] });
  const { data: overview } = useQuery<Overview>({
    queryKey: ["/api/content-platform/overview"],
  });
  const {
    data: promo,
    isPending: promoPending,
    isError: promoIsError,
    error: promoError,
  } = useQuery<PromotionResp>({
    queryKey: ["/api/content-platform/promotion-candidates"],
  });
  const {
    data: ghIssues,
    isPending: ghIssuesPending,
    isError: ghIssuesIsError,
    error: ghIssuesError,
  } = useQuery<GhIssuesResp>({
    queryKey: ["/api/gh-issues?state=open&labels=blocker"],
  });
  const {
    data: ghBugs,
    isPending: ghBugsPending,
    isError: ghBugsIsError,
    error: ghBugsError,
  } = useQuery<GhIssuesResp>({
    queryKey: ["/api/gh-issues?state=open&labels=bug"],
  });
  const blockersPending = ghIssuesPending || ghBugsPending;
  const blockersIsError = ghIssuesIsError || ghBugsIsError;
  const blockersError = ghIssuesError || ghBugsError;

  const blockers = [
    ...(ghIssues?.issues ?? []),
    ...(ghBugs?.issues ?? []),
  ]
    .filter(
      (iss, idx, arr) =>
        arr.findIndex((x) => x.number === iss.number && x.repo === iss.repo) === idx,
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);

  const candidates = promo?.candidates ?? [];

  const topThemes: VeoTheme[] = (overview?.veo_themes_7d ?? [])
    .slice()
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 3);

  const narrative = kpis ? buildNarrative(kpis) : [];
  const idsDelta = kpis
    ? deltaPctPoints(kpis.ids_convergence_pct, kpis.prior_7d?.ids_convergence_pct)
    : null;
  const roasDelta = kpis
    ? deltaRatio(kpis.gmv_max_roas_7d, kpis.prior_7d?.gmv_max_roas_7d)
    : null;

  return (
    <Layout
      title="DNA · Executive Brief"
      subtitle="IDS convergence · Bandit M11 · win-rate · GMV Max ROAS · WoW deltas"
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 1. DNA KPI hero strip */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              DNA KPIs (current)
              <Badge variant="secondary" className="ml-1">
                7d window
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {kpisPending ? (
              <Skeleton lines={3} />
            ) : kpisIsError ? (
              <ErrorState title="Failed to load DNA KPIs" error={kpisError} />
            ) : !kpis ? (
              <Skeleton lines={3} />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KpiMetric
                    icon={<Target className="h-3.5 w-3.5" />}
                    label="IDS convergence"
                    value={fmtPct(kpis.ids_convergence_pct, 0)}
                    sub={`target ${kpis.ids_target.toFixed(2)}`}
                    progress={kpis.ids_convergence_pct ?? null}
                    delta={idsDelta != null ? `${idsDelta >= 0 ? "+" : ""}${idsDelta}pp WoW` : null}
                  />
                  <KpiMetric
                    icon={<Activity className="h-3.5 w-3.5" />}
                    label="Bandit M11"
                    value={fmtPct(kpis.bandit_m11_progress, 0)}
                    sub="convergence score"
                    progress={kpis.bandit_m11_progress ?? null}
                  />
                  <KpiMetric
                    icon={<Trophy className="h-3.5 w-3.5" />}
                    label="Win-rate 24h"
                    value={fmtPct(kpis.video_win_rate_24h)}
                    sub="Veo 3.1 Fast"
                  />
                  <KpiMetric
                    icon={<DollarSign className="h-3.5 w-3.5" />}
                    label="GMV Max ROAS 7d"
                    value={fmtRoas(kpis.gmv_max_roas_7d)}
                    sub={kpis.neon_available ? "DNA creative" : "Neon unset"}
                    delta={roasDelta != null ? `${roasDelta >= 0 ? "+" : ""}${roasDelta}% WoW` : null}
                  />
                </div>

                <div
                  className="mt-5 rounded-md border border-card-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground/90 space-y-1.5"
                  data-testid="weekly-narrative"
                >
                  {narrative.map((line, i) => (
                    <p key={i}>{line}</p>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* 2. Promotion candidates */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Promotion candidates
              <Badge variant="secondary" className="ml-1">
                IDS ≥ 0.85 · Δ ≥ +10pp
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {promoPending ? (
              <Skeleton lines={3} />
            ) : promoIsError ? (
              <ErrorState title="Failed to load promotion candidates" error={promoError} />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {DASH} no completed runs currently clear the promotion gate.
              </p>
            ) : (
              <ul className="space-y-2">
                {candidates.map((c) => (
                  <li
                    key={c.run_id}
                    className="flex items-center justify-between gap-3 p-3 rounded-md border border-card-border"
                    data-testid={`promo-candidate-${c.run_id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate">{c.theme || DASH}</div>
                      <div className="text-xs text-muted-foreground">
                        run <span className="font-mono">{c.run_id.slice(0, 8)}</span> ·{" "}
                        {c.videos_scored}/{c.videos_budget} videos
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="tabular-nums">
                        IDS {fmtPct(c.ids_mean)}
                      </Badge>
                      <Badge variant="default" className="tabular-nums">
                        Δ {fmtDelta(c.delta_vs_control)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* 3. Blockers */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-rose-500" />
              Blockers
              <Badge variant="secondary" className="ml-1">
                open · blocker/bug
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {blockersIsError ? (
              <ErrorState title="Failed to load blockers from GitHub" error={blockersError} />
            ) : blockersPending ? (
              <Skeleton lines={3} />
            ) : blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {DASH} no open blockers across content repos.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {blockers.map((b) => (
                  <li
                    key={`${b.repo}-${b.number}`}
                    className="text-sm flex items-baseline gap-3"
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

        {/* 4. Veo spend (7d) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              Veo spend (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3 mb-3">
              <span className="text-2xl font-semibold tabular-nums">
                {fmtUsd(overview?.veo_spend_7d_usd)}
              </span>
              <span className="text-xs text-muted-foreground">
                total Veo cost · 7-day window
              </span>
            </div>
            {topThemes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {DASH} per-theme breakdown not available.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {topThemes.map((t) => (
                  <li
                    key={t.theme}
                    className="flex items-center justify-between gap-3 p-2 rounded-md border border-card-border text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{t.theme || DASH}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtInt(t.calls)} calls · {fmtInt(t.winning_videos)} winners
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="font-semibold">{fmtUsd(t.total_cost_usd)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {fmtUsd(t.cost_per_winner)}/winner
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function KpiMetric({
  icon,
  label,
  value,
  sub,
  progress,
  delta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  progress?: number | null;
  delta?: string | null;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon} {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
      {progress != null && (
        <div className="mt-1.5">
          <ProgressBar value={progress} />
        </div>
      )}
      {delta && (
        <div
          className={
            "text-xs tabular-nums mt-1 " +
            (delta.startsWith("+")
              ? "text-emerald-600"
              : delta.startsWith("-")
              ? "text-rose-600"
              : "text-muted-foreground")
          }
        >
          {delta}
        </div>
      )}
    </div>
  );
}
