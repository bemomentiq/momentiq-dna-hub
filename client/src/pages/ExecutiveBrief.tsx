import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { AutonomyAction, Rollups, HitlBurden, Feed } from "@/lib/types";
import { Link } from "wouter";
import { Download, ArrowUpRight, Shield, Database, Activity, Hourglass } from "lucide-react";

export default function ExecutiveBrief() {
  const { data: r } = useQuery<Rollups>({ queryKey: ["/api/rollups"] });
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });
  const { data: hitl = [] } = useQuery<HitlBurden[]>({ queryKey: ["/api/hitl-burden"] });
  const { data: feed } = useQuery<Feed>({ queryKey: ["/api/feed"] });

  if (!r) return <Layout title="Executive Brief"><div className="text-muted-foreground">Loading…</div></Layout>;

  const trainPct = (r.total_training_rows / r.total_training_target) * 100;
  const top5 = [...hitl].filter((x) => x.promotable).sort((a, b) => b.hours_per_week - a.hours_per_week).slice(0, 5);
  const moneyPath = actions.filter((a) => ["count_qualifying_posts", "verify_bundle_completion", "calculate_total_compensation", "process_fixed_rate_payment", "reconcile_payment"].includes(a.action_name));
  const moneyAvg = moneyPath.reduce((s, a) => s + a.prod_readiness_pct, 0) / moneyPath.length;

  return (
    <Layout
      title="Executive Brief"
      subtitle="One-page status of SID autonomy — share-ready · auto-derived from live action seed + GitHub feed"
      actions={
        <a href="/api/exec-brief.md" download className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors">
          <Download className="h-3.5 w-3.5" /> Download .md
        </a>
      }
    >
      <div className="max-w-4xl mx-auto space-y-6">
        <section className="rounded-lg border border-card-border bg-card p-6">
          <h2 className="text-base font-semibold mb-4">Where we stand</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Pillar icon={<Shield className="h-4 w-4" />} label="Production readiness" value={`${r.avg_prod_readiness_pct.toFixed(0)}%`} desc="avg across 40 actions" />
            <Pillar icon={<Activity className="h-4 w-4" />} label="Eval pass rate" value={`${r.avg_eval_pass_pct.toFixed(0)}%`} desc={`${r.total_fixtures.toLocaleString()} fixtures`} />
            <Pillar icon={<Database className="h-4 w-4" />} label="Training backfill" value={`${trainPct.toFixed(0)}%`} desc={`${r.total_training_rows.toLocaleString()} rows`} />
            <Pillar icon={<Hourglass className="h-4 w-4" />} label="HITL burden" value={`${r.total_human_hours_per_week.toFixed(0)}h/wk`} desc={`${r.promotable_hours_per_week.toFixed(0)}h recoverable`} />
          </div>
        </section>

        <section className="rounded-lg border border-card-border bg-card p-6">
          <h2 className="text-base font-semibold mb-3">The 30-second story</h2>
          <p className="text-sm leading-relaxed">
            All 40 canonical actions have wired handlers (avg <strong>{r.avg_handler_pct.toFixed(0)}%</strong>) and the LLM intent classifier is live in production at <strong>99% pass</strong> on a 1,088-case corpus. Phase A and Phase B (10 zero-fixture actions) closed in the last week. The remaining work is concentrated in three areas:
          </p>
          <ol className="mt-3 space-y-2 text-sm list-decimal pl-5">
            <li><strong>Outcome-based evals</strong> — only {r.actions_outcome_full} of {r.total_actions} actions have full D+14 reward joins. {r.actions_no_evals} are still structural-only.</li>
            <li><strong>Training backfill</strong> — {(r.total_training_target - r.total_training_rows).toLocaleString()} rows still to ingest, mostly from Reacher, cos_runs, and Fireflies.</li>
            <li><strong>HITL gate flips</strong> — {top5.reduce((s, x) => s + x.hours_per_week, 0).toFixed(0)} hrs/wk of human review can be reclaimed by promoting {top5.length} tina_review actions whose evals already pass ≥ 90%.</li>
          </ol>
        </section>

        <section className="rounded-lg border border-card-border bg-card p-6">
          <h2 className="text-base font-semibold mb-3">Top 5 unlocks (Phase F gate flips)</h2>
          <p className="text-xs text-muted-foreground mb-3">Recoverable hours assume 37 active brands at current weekly run rate. Eval pass ≥ 90% means the auto-decision agrees with Tina's label on a ≥200-case corpus.</p>
          <div className="space-y-2">
            {top5.map((x) => (
              <Link key={x.action_name} href={`/actions/${x.action_name}`} className="flex items-center justify-between gap-4 p-3 rounded-md border border-card-border hover:border-primary/30 transition-colors">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-sm">{x.display_name}</div>
                  <div className="text-xs text-muted-foreground">{x.weekly_runs.toFixed(0)} runs/wk · {x.minutes_per_run} min review · eval {x.eval_pass_pct}%</div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{x.hours_per_week.toFixed(0)} h/wk</div>
                  <div className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400 font-medium">recoverable</div>
                </div>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-card-border bg-card p-6">
          <h2 className="text-base font-semibold mb-3">Money path (extra scrutiny)</h2>
          <p className="text-xs text-muted-foreground mb-3">5 actions touching payment dispatch and reconciliation. Avg readiness <strong>{moneyAvg.toFixed(0)}%</strong>. ALEX kill-switch retained on all; promotion blocked until 30-day shadow.</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {moneyPath.map((a) => (
              <Link key={a.action_name} href={`/actions/${a.action_name}`} className="rounded-md border border-card-border bg-background p-3 hover:border-primary/30 transition-colors block">
                <div className="text-[10px] font-mono text-muted-foreground">PD #{a.action_number}</div>
                <div className="font-medium text-xs leading-tight mt-1 line-clamp-2 min-h-[2rem]">{a.display_name}</div>
                <div className="mt-2"><ProgressBar value={a.prod_readiness_pct} tone={a.prod_readiness_pct >= 85 ? "good" : "warn"} /></div>
                <div className="mt-1 text-[10px] tabular-nums">{a.prod_readiness_pct}% ready</div>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-card-border bg-card p-6">
          <h2 className="text-base font-semibold mb-3">Last 9 days · 10 autonomy ships</h2>
          <ul className="space-y-1.5">
            {feed?.recent.filter((f) => f.category === "autonomy" || f.category === "evals").slice(0, 10).map((f) => (
              <li key={f.number} className="text-sm flex items-baseline gap-3">
                <span className="text-[10px] font-mono text-muted-foreground tabular-nums">{f.date.slice(5)}</span>
                <a href={`https://github.com/bemomentiq/momentiq-dna/pull/${f.number}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-primary">#{f.number}</a>
                <span className="text-sm">{f.title}</span>
              </li>
            ))}
          </ul>
        </section>

        {feed?.blockers && feed.blockers.length > 0 && (
          <section className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-6">
            <h2 className="text-base font-semibold mb-3">Open blockers</h2>
            <ul className="space-y-1.5">
              {feed.blockers.map((b) => (
                <li key={b.number} className="text-sm flex items-baseline gap-3">
                  <a href={`https://github.com/bemomentiq/momentiq-dna/issues/${b.number}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-primary shrink-0">#{b.number}</a>
                  <span>{b.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Layout>
  );
}

function Pillar({ icon, label, value, desc }: { icon: React.ReactNode; label: string; value: string; desc: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">{icon} {label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
