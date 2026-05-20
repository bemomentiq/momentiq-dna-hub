import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { ArrowLeft, Activity, DollarSign, TrendingUp, GitBranch, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type ThemeOptimalConfig = {
  theme: string;
  champion_config_id: string | null;
  ids_median: number | null;
  delta_vs_control: number | null;
  promoted_at: string | null;
  thompson_alpha: number | null;
  thompson_beta: number | null;
};

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

type ThemeDetailPayload = {
  dna_configured: boolean;
  slug: string;
  theme: ThemeOptimalConfig | null;
  variants: AbRun[] | null;
  fetched_at: string;
};

const dash = "—";

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return dash;
  return v.toFixed(digits);
}

function fmtUsd(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return dash;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return dash;
  try {
    return new Date(v).toLocaleDateString();
  } catch {
    return v;
  }
}

function statusTone(s: AbRun["status"]) {
  switch (s) {
    case "promoted":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case "running":
      return "border-blue-500/30 bg-blue-500/10 text-blue-400";
    case "completed":
      return "border-slate-500/30 bg-slate-500/10 text-slate-300";
    case "rejected":
      return "border-red-500/30 bg-red-500/10 text-red-400";
    default:
      return "border-card-border bg-muted text-muted-foreground";
  }
}

export default function ThemeDetail() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;
  const { data, isLoading, isError, error, refetch } = useQuery<ThemeDetailPayload>({
    queryKey: ["/api/content-platform/themes", slug],
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <Layout title="Loading…">
        <div className="text-muted-foreground">Loading theme…</div>
      </Layout>
    );
  }

  const backLink = (
    <Link
      href="/"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      data-testid="link-back"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> Back
    </Link>
  );

  // Distinguish a real fetch failure (network/5xx) from the upstream
  // explicitly reporting that DNA isn't configured. Bugbot flagged that
  // collapsing these to one empty-state hides errors.
  if (isError || !data) {
    return (
      <Layout title={slug ?? "Theme"} subtitle="Per-theme drill-down" actions={backLink}>
        <div className="rounded-lg border border-destructive/40 bg-card p-8 text-center">
          <h3 className="font-semibold text-sm mb-1">Failed to load theme</h3>
          <p className="text-xs text-muted-foreground mb-3">
            {error instanceof Error ? error.message : "The /api/content-platform/themes request failed."}
          </p>
          <button
            onClick={() => refetch()}
            className="text-xs px-3 py-1.5 rounded border border-card-border hover:bg-muted"
            data-testid="button-retry"
          >
            Retry
          </button>
        </div>
      </Layout>
    );
  }

  if (!data.dna_configured) {
    return (
      <Layout title={slug ?? "Theme"} subtitle="Per-theme drill-down" actions={backLink}>
        <div className="rounded-lg border border-dashed border-card-border bg-card p-8 text-center">
          <Sparkles className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          <div className="font-medium">DNA service not configured</div>
          <p className="text-sm text-muted-foreground mt-1">
            Set <code className="font-mono text-xs">DNA_API_BASE</code> on the server to enable
            theme drill-downs.
          </p>
        </div>
      </Layout>
    );
  }

  const theme = data.theme;
  const variants = data.variants ?? [];

  if (!theme) {
    return (
      <Layout title={slug ?? "Theme"} subtitle="Per-theme drill-down" actions={backLink}>
        <div className="rounded-lg border border-dashed border-card-border bg-card p-8 text-center">
          <div className="font-medium">No data for this theme yet</div>
          <p className="text-sm text-muted-foreground mt-1">
            No champion configuration or A/B runs have been recorded for{" "}
            <span className="font-mono">{slug}</span>.
          </p>
        </div>
      </Layout>
    );
  }

  const totalVeoCost = variants.reduce((s, v) => s + (v.veo_cost_usd ?? 0), 0);
  const totalRoi = variants.reduce((s, v) => s + (v.roi_usd ?? 0), 0);

  return (
    <Layout
      title={theme.theme || slug || "Theme"}
      subtitle="Champion configuration, A/B variants, and promotion lineage"
      actions={backLink}
    >
      {/* Champion summary card */}
      <section className="rounded-lg border border-card-border bg-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-emerald-400" />
          <h3 className="font-semibold">Champion</h3>
          {theme.champion_config_id ? (
            <span className="font-mono text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
              {theme.champion_config_id}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">no champion promoted yet</span>
          )}
          {theme.promoted_at && (
            <span className="text-xs text-muted-foreground ml-auto">
              promoted {fmtDate(theme.promoted_at)}
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="IDS median"
            value={fmtNum(theme.ids_median, 3)}
            sub="indistinguishability"
          />
          <StatCard
            label="Δ vs control"
            value={theme.delta_vs_control == null ? dash : `${theme.delta_vs_control >= 0 ? "+" : ""}${fmtNum(theme.delta_vs_control, 3)}`}
            sub="champion − control"
            tone={theme.delta_vs_control != null && theme.delta_vs_control >= 0.1 ? "good" : "warn"}
          />
          <StatCard
            label="Veo cost (variants)"
            value={fmtUsd(totalVeoCost)}
            sub={`${variants.length} run${variants.length === 1 ? "" : "s"}`}
          />
          <StatCard label="ROI (variants)" value={fmtUsd(totalRoi)} sub="sum across variants" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3 text-xs text-muted-foreground">
          <div>
            <span className="uppercase tracking-wide text-[10px]">Thompson α</span>
            <div className="font-mono text-foreground">{fmtNum(theme.thompson_alpha, 2)}</div>
          </div>
          <div>
            <span className="uppercase tracking-wide text-[10px]">Thompson β</span>
            <div className="font-mono text-foreground">{fmtNum(theme.thompson_beta, 2)}</div>
          </div>
        </div>
      </section>

      {/* Variants table */}
      <section className="rounded-lg border border-card-border bg-card p-5 mb-5">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">A/B variants</h3>
          <span className="text-xs text-muted-foreground">{variants.length}</span>
        </div>
        {variants.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No A/B runs recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-card-border">
                  <th className="text-left py-2 pr-3">Run</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-right py-2 pr-3">Videos</th>
                  <th className="text-right py-2 pr-3">IDS mean</th>
                  <th className="text-right py-2 pr-3">Δ control</th>
                  <th className="text-right py-2 pr-3">Veo $</th>
                  <th className="text-right py-2 pr-3">ROI</th>
                  <th className="text-left py-2 pr-3">Started</th>
                  <th className="text-left py-2">Completed</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v) => (
                  <tr
                    key={v.run_id}
                    className="border-b border-card-border last:border-0"
                    data-testid={`row-variant-${v.run_id}`}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{v.run_id}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={cn(
                          "inline-flex items-center px-2 py-0.5 rounded text-[11px] border",
                          statusTone(v.status),
                        )}
                      >
                        {v.status}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {v.videos_scored}
                      <span className="text-muted-foreground"> / {v.videos_budget}</span>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(v.ids_mean, 3)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {v.delta_vs_control == null
                        ? dash
                        : `${v.delta_vs_control >= 0 ? "+" : ""}${fmtNum(v.delta_vs_control, 3)}`}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(v.veo_cost_usd)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(v.roi_usd)}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{fmtDate(v.started_at)}</td>
                    <td className="py-2 text-muted-foreground">{fmtDate(v.completed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lineage strip */}
      <section className="rounded-lg border border-card-border bg-card p-5">
        <div className="flex items-center gap-2 mb-3">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold">Lineage</h3>
        </div>
        {variants.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No lineage recorded.</div>
        ) : (
          <ol className="flex flex-wrap items-center gap-2 text-xs">
            {variants
              .slice()
              .sort((a, b) => a.started_at.localeCompare(b.started_at))
              .map((v, i) => {
                const isChampion = v.status === "promoted";
                return (
                  <li key={v.run_id} className="flex items-center gap-2">
                    <div
                      className={cn(
                        "inline-flex flex-col items-start gap-0.5 px-2 py-1.5 rounded border",
                        isChampion
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-card-border bg-muted",
                      )}
                    >
                      <span className="font-mono text-[11px]">{v.run_id}</span>
                      <span className="text-[10px] text-muted-foreground">
                        IDS {fmtNum(v.ids_mean, 2)} · {fmtDate(v.started_at)}
                      </span>
                    </div>
                    {i < variants.length - 1 && (
                      <TrendingUp className="h-3 w-3 text-muted-foreground" />
                    )}
                  </li>
                );
              })}
          </ol>
        )}
        <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
          <DollarSign className="h-3 w-3" />
          <span>Total Veo spend on this theme: {fmtUsd(totalVeoCost)}</span>
          <span>·</span>
          <span>Net ROI: {fmtUsd(totalRoi)}</span>
        </div>
      </section>
    </Layout>
  );
}
