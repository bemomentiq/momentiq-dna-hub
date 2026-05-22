import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { StatCard } from "@/components/StatCard";
import { Skeleton } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Video, FlaskConical, Target, DollarSign, FileText, Film, AlertTriangle, Users } from "lucide-react";

type CorpusStats = {
  videos: number;
  gmv_usd: number;
  last_harvest_at: string | null;
};

type ScriptSageStats = {
  scripts_generated_24h: number;
  scripts_generated_7d: number;
  videos_generated_24h: number;
  videos_generated_7d: number;
  fallback_rate_24h: number;
  error_rate_24h: number;
  status_sync_lag_seconds: number;
};

type SubscriptionStats = {
  active_users: number;
  mrr_usd: number;
  tier_mix: { tier: string; count: number; mrr_usd: number }[];
  top_users_by_credit_burn: { user_id: string; email: string | null; credits_30d: number }[];
};

type ContentPlatformOverview = {
  dna_configured: boolean;
  scriptsage_configured: boolean;
  corpus: CorpusStats | null;
  ab_runs_active: number | null;
  ids_median_7d: number | null;
  veo_spend_7d_usd: number | null;
  scriptsage: ScriptSageStats | null;
  subscriptions: SubscriptionStats | null;
  fetched_at: string;
};

const DASH = "—";

function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return Math.round(n).toLocaleString();
}

function fmtUsd(n: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  if (opts.compact && Math.abs(n) >= 1000) {
    return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  // accept either 0-1 fraction or already-percent
  const v = n <= 1 ? n * 100 : n;
  return `${v.toFixed(1)}%`;
}

function idsTone(v: number | null): "good" | "warn" | "bad" | "default" {
  if (v == null || !Number.isFinite(v)) return "default";
  if (v >= 0.85) return "good";
  if (v >= 0.7) return "warn";
  return "bad";
}

function idsBadgeClass(tone: "good" | "warn" | "bad" | "default"): string {
  return {
    good: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
    warn: "bg-amber-500/15 text-amber-500 border-amber-500/40",
    bad: "bg-rose-500/15 text-rose-500 border-rose-500/40",
    default: "bg-muted text-muted-foreground border-card-border",
  }[tone];
}

function NotConnected({ label }: { label: string }) {
  return (
    <span className="text-xs text-muted-foreground italic" data-testid={`not-connected-${label}`}>
      not connected
    </span>
  );
}

export default function Overview() {
  const { data, isLoading } = useQuery<ContentPlatformOverview>({
    queryKey: ["/api/content-platform/overview"],
  });

  if (isLoading || !data) {
    return (
      <Layout title="Content Platform Overview">
        <Skeleton lines={6} />
      </Layout>
    );
  }

  const {
    dna_configured,
    scriptsage_configured,
    corpus,
    ab_runs_active,
    ids_median_7d,
    veo_spend_7d_usd,
    scriptsage,
    subscriptions,
  } = data;

  const idsT = idsTone(ids_median_7d);

  return (
    <Layout
      title="Content Platform Overview"
      subtitle="momentiq-dna · scriptsage · TikTok Shop AI content pipeline"
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Corpus Videos"
          icon={<Video className="h-4 w-4" />}
          value={dna_configured ? fmtInt(corpus?.videos) : <NotConnected label="corpus-videos" />}
          sub={
            dna_configured
              ? `GMV ${fmtUsd(corpus?.gmv_usd ?? null, { compact: true })}`
              : "DNA_API_BASE unset"
          }
        />

        <StatCard
          label="Active A/B Runs"
          icon={<FlaskConical className="h-4 w-4" />}
          value={dna_configured ? fmtInt(ab_runs_active) : <NotConnected label="ab-runs" />}
          sub={dna_configured ? "running tests" : "DNA_API_BASE unset"}
        />

        <StatCard
          label="IDS Median 7d"
          icon={<Target className="h-4 w-4" />}
          tone={idsT === "default" ? "default" : idsT}
          value={
            dna_configured ? (
              <span className="flex items-center gap-2">
                <span>{ids_median_7d != null ? ids_median_7d.toFixed(2) : DASH}</span>
                {ids_median_7d != null && (
                  <Badge variant="outline" className={idsBadgeClass(idsT)}>
                    {idsT === "good" ? "≥0.85" : idsT === "warn" ? "0.70–0.84" : "<0.70"}
                  </Badge>
                )}
              </span>
            ) : (
              <NotConnected label="ids" />
            )
          }
          sub={dna_configured ? "indistinguishability score" : "DNA_API_BASE unset"}
        />

        <StatCard
          label="Veo Spend 7d"
          icon={<DollarSign className="h-4 w-4" />}
          value={dna_configured ? fmtUsd(veo_spend_7d_usd, { compact: true }) : <NotConnected label="veo-spend" />}
          sub={dna_configured ? "Veo 3.1 generation cost" : "DNA_API_BASE unset"}
        />

        <StatCard
          label="ScriptSage Scripts /24h"
          icon={<FileText className="h-4 w-4" />}
          value={scriptsage_configured ? fmtInt(scriptsage?.scripts_generated_24h) : <NotConnected label="scripts" />}
          sub={
            scriptsage_configured
              ? `${fmtInt(scriptsage?.scripts_generated_7d)} over 7d`
              : "SCRIPTSAGE_API_BASE unset"
          }
        />

        <StatCard
          label="ScriptSage Videos /24h"
          icon={<Film className="h-4 w-4" />}
          value={scriptsage_configured ? fmtInt(scriptsage?.videos_generated_24h) : <NotConnected label="videos" />}
          sub={
            scriptsage_configured
              ? `${fmtInt(scriptsage?.videos_generated_7d)} over 7d`
              : "SCRIPTSAGE_API_BASE unset"
          }
        />

        <StatCard
          label="Fallback / Error Rate"
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={
            scriptsage_configured && scriptsage
              ? scriptsage.error_rate_24h > 0.05 || scriptsage.fallback_rate_24h > 0.2
                ? "warn"
                : "good"
              : "default"
          }
          value={
            scriptsage_configured ? (
              <span className="text-base">
                {fmtPct(scriptsage?.fallback_rate_24h)} <span className="text-muted-foreground">/</span>{" "}
                {fmtPct(scriptsage?.error_rate_24h)}
              </span>
            ) : (
              <NotConnected label="rates" />
            )
          }
          sub={scriptsage_configured ? "fallback / error · 24h" : "SCRIPTSAGE_API_BASE unset"}
        />

        <StatCard
          label="MRR · Subscribers"
          icon={<Users className="h-4 w-4" />}
          value={
            scriptsage_configured ? (
              <span className="text-base">
                {fmtUsd(subscriptions?.mrr_usd ?? null, { compact: true })}{" "}
                <span className="text-muted-foreground">·</span> {fmtInt(subscriptions?.active_users)}
              </span>
            ) : (
              <NotConnected label="mrr" />
            )
          }
          sub={scriptsage_configured ? "monthly recurring · active users" : "SCRIPTSAGE_API_BASE unset"}
        />
      </div>

      {(!dna_configured || !scriptsage_configured) && (
        <div className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-muted-foreground">
          <div className="font-medium text-amber-500 mb-1">Upstream services not fully configured</div>
          <ul className="space-y-0.5">
            {!dna_configured && <li>· Set <code className="font-mono">DNA_API_BASE</code> to connect momentiq-dna.</li>}
            {!scriptsage_configured && (
              <li>· Set <code className="font-mono">SCRIPTSAGE_API_BASE</code> to connect scriptsage-backend.</li>
            )}
          </ul>
        </div>
      )}
    </Layout>
  );
}
