import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Sparkles, AlertOctagon, DollarSign, ExternalLink } from "lucide-react";

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
  scriptsage_configured: boolean;
  corpus: { videos: number; gmv_usd: number; last_harvest_at: string | null } | null;
  ab_runs_active: number | null;
  ids_median_7d: number | null;
  veo_spend_7d_usd: number | null;
  veo_themes_7d: VeoTheme[] | null;
  scriptsage: {
    scripts_generated_7d: number;
    videos_generated_7d: number;
    scripts_generated_24h: number;
    videos_generated_24h: number;
  } | null;
  subscriptions: { active_users: number; mrr_usd: number } | null;
  fetched_at: string;
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

const dash = "—";

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dash;
  return n.toLocaleString();
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dash;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dash;
  return `${(n * 100).toFixed(0)}%`;
}

function fmtDelta(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return dash;
  const sign = n >= 0 ? "+" : "";
  return `${sign}${(n * 100).toFixed(1)}pp`;
}

export default function ExecutiveBrief() {
  const { data: overview } = useQuery<Overview>({ queryKey: ["/api/content-platform/overview"] });
  const {
    data: promo,
    isPending: promoPending,
    isError: promoIsError,
    error: promoError,
  } = useQuery<PromotionResp>({ queryKey: ["/api/content-platform/promotion-candidates"] });
  const {
    data: ghIssues,
    isError: ghIssuesIsError,
    error: ghIssuesError,
  } = useQuery<GhIssuesResp>({
    queryKey: ["/api/gh-issues?state=open&labels=blocker"],
  });
  const {
    data: ghBugs,
    isError: ghBugsIsError,
    error: ghBugsError,
  } = useQuery<GhIssuesResp>({
    queryKey: ["/api/gh-issues?state=open&labels=bug"],
  });
  const blockersIsError = ghIssuesIsError || ghBugsIsError;
  const blockersError = ghIssuesError || ghBugsError;

  const blockers = [
    ...(ghIssues?.issues ?? []),
    ...(ghBugs?.issues ?? []),
  ]
    .filter(
      (iss, idx, arr) =>
        arr.findIndex((x) => x.number === iss.number && x.repo === iss.repo) === idx
    )
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5);

  const candidates = promo?.candidates ?? [];

  const topThemes: VeoTheme[] = (overview?.veo_themes_7d ?? [])
    .slice()
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .slice(0, 3);

  return (
    <Layout
      title="AI Content Platform · Executive Brief"
      subtitle="Live snapshot of corpus growth, A/B promotions, blockers, and Veo spend"
    >
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 1. Topline (7d) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              Topline (7d)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Metric
                label="Corpus size"
                value={fmtNum(overview?.corpus?.videos)}
                sub={
                  overview?.corpus?.last_harvest_at
                    ? `last harvest ${overview.corpus.last_harvest_at.slice(0, 10)}`
                    : dash
                }
              />
              <Metric
                label="Scripts generated"
                value={fmtNum(overview?.scriptsage?.scripts_generated_7d)}
                sub={
                  overview?.scriptsage
                    ? `${fmtNum(overview.scriptsage.scripts_generated_24h)} in 24h`
                    : dash
                }
              />
              <Metric
                label="Videos generated"
                value={fmtNum(overview?.scriptsage?.videos_generated_7d)}
                sub={
                  overview?.scriptsage
                    ? `${fmtNum(overview.scriptsage.videos_generated_24h)} in 24h`
                    : dash
                }
              />
              <Metric
                label="MRR"
                value={fmtUsd(overview?.subscriptions?.mrr_usd)}
                sub={
                  overview?.subscriptions
                    ? `${fmtNum(overview.subscriptions.active_users)} active users`
                    : dash
                }
              />
            </div>
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
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : promoIsError ? (
              <div
                className="text-sm text-rose-600 dark:text-rose-400 p-3 rounded-md border border-rose-500/30 bg-rose-500/5"
                data-testid="promo-error"
              >
                Failed to load promotion candidates
                {promoError instanceof Error ? ` — ${promoError.message}` : ""}
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {dash} no completed runs currently clear the promotion gate.
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
                      <div className="font-medium text-sm truncate">{c.theme || dash}</div>
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
              <div
                className="text-sm text-rose-600 dark:text-rose-400 p-3 rounded-md border border-rose-500/30 bg-rose-500/5"
                data-testid="blockers-error"
              >
                Failed to load blockers from GitHub
                {blockersError instanceof Error ? ` — ${blockersError.message}` : ""}
              </div>
            ) : blockers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {dash} no open blockers across content repos.
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
                {dash} per-theme breakdown not available.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {topThemes.map((t) => (
                  <li
                    key={t.theme}
                    className="flex items-center justify-between gap-3 p-2 rounded-md border border-card-border text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{t.theme || dash}</div>
                      <div className="text-xs text-muted-foreground">
                        {fmtNum(t.calls)} calls · {fmtNum(t.winning_videos)} winners
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

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
