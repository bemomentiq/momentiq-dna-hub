import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { StatCard, ProgressBar } from "@/components/StatCard";
import type { AutonomyAction, Rollups, Feed } from "@/lib/types";
import { Link } from "wouter";
import { CheckCircle2, AlertTriangle, Database, Activity, Shield, Target, Hourglass, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell, Legend as RLegend } from "recharts";

function tone(pct: number) {
  if (pct >= 85) return "good" as const;
  if (pct >= 65) return "warn" as const;
  return "bad" as const;
}

function HeatCell({ a }: { a: AutonomyAction }) {
  const t = tone(a.prod_readiness_pct);
  const bg = {
    good: "bg-emerald-500/15 hover:bg-emerald-500/25 border-emerald-500/30",
    warn: "bg-amber-500/15 hover:bg-amber-500/25 border-amber-500/30",
    bad: "bg-rose-500/15 hover:bg-rose-500/25 border-rose-500/30",
  }[t];
  return (
    <Link
      href={`/actions/${a.action_name}`}
      className={cn("rounded-md border p-2 transition-all block", bg)}
      data-testid={`heat-cell-${a.action_name}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-mono text-muted-foreground">#{a.action_number}</span>
        <span className="text-[10px] font-semibold tabular-nums">{a.prod_readiness_pct}%</span>
      </div>
      <div className="mt-1 text-[11px] font-medium leading-tight line-clamp-3 min-h-[2.6rem]">{a.display_name}</div>
      <div className="mt-1.5 flex gap-0.5">
        <span className="flex-1 h-1 rounded-full" style={{ background: `hsl(var(--primary) / ${a.handler_pct / 100})` }} title={`Handler ${a.handler_pct}%`} />
        <span className="flex-1 h-1 rounded-full" style={{ background: `hsl(173 58% 45% / ${a.training_backfill_pct / 100})` }} title={`Training ${a.training_backfill_pct}%`} />
        <span className="flex-1 h-1 rounded-full" style={{ background: `hsl(43 74% 49% / ${(a.eval_pass_pct ?? 0) / 100})` }} title={`Evals ${a.eval_pass_pct ?? 0}%`} />
      </div>
    </Link>
  );
}

export default function Overview() {
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });
  const { data: r } = useQuery<Rollups>({ queryKey: ["/api/rollups"] });
  const { data: feed } = useQuery<Feed>({ queryKey: ["/api/feed"] });

  if (!r) return <Layout title="Overview"><div className="text-muted-foreground">Loading…</div></Layout>;

  const sampling = actions.filter((a) => a.class === "sampling").sort((a, b) => a.action_number - b.action_number);
  const paid = actions.filter((a) => a.class === "paid_deal").sort((a, b) => a.action_number - b.action_number);

  const trainingPct = (r.total_training_rows / r.total_training_target) * 100;

  // Distribution buckets for prod readiness
  const buckets = [0, 50, 65, 75, 85, 90, 95, 100];
  const distribution = buckets.slice(0, -1).map((lo, i) => {
    const hi = buckets[i + 1];
    const count = actions.filter((a) => a.prod_readiness_pct >= lo && a.prod_readiness_pct < hi).length;
    return { bucket: `${lo}-${hi}%`, count, fill: hi <= 65 ? "hsl(0 70% 55%)" : hi <= 85 ? "hsl(43 74% 49%)" : "hsl(158 64% 38%)" };
  });

  // Avg by class — handler / training / eval / prod
  const byClass = (["sampling", "paid_deal"] as const).map((c) => {
    const list = actions.filter((a) => a.class === c);
    const avg = (k: keyof AutonomyAction) => list.reduce((s, a) => s + ((a[k] as number) ?? 0), 0) / list.length;
    return {
      cls: c === "sampling" ? "Sampling" : "Paid Deal",
      Handler: Math.round(avg("handler_pct")),
      Training: Math.round(avg("training_backfill_pct")),
      Eval: Math.round(list.filter((a) => a.eval_pass_pct != null).reduce((s, a) => s + (a.eval_pass_pct ?? 0), 0) / list.filter((a) => a.eval_pass_pct != null).length),
      Prod: Math.round(avg("prod_readiness_pct")),
    };
  });

  return (
    <Layout
      title="Autonomy Completion Hub"
      subtitle="40 canonical actions · 14 sampling + 26 paid_deal · L0 across the board · snapshot 2026-04-29"
      actions={
        <div className="flex items-center gap-2">
          <a href="/api/exec-brief.md" download className="text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors">Brief.md</a>
          <a href="/api/actions.csv" download className="text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors">Actions.csv</a>
        </div>
      }
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
        <StatCard label="Production Readiness" value={`${r.avg_prod_readiness_pct.toFixed(0)}%`} sub={<ProgressBar value={r.avg_prod_readiness_pct} tone={tone(r.avg_prod_readiness_pct)} />} tone={tone(r.avg_prod_readiness_pct)} icon={<Shield className="h-4 w-4" />} />
        <StatCard label="Handler Wired %" value={`${r.avg_handler_pct.toFixed(0)}%`} sub={<ProgressBar value={r.avg_handler_pct} tone={tone(r.avg_handler_pct)} />} tone={tone(r.avg_handler_pct)} icon={<CheckCircle2 className="h-4 w-4" />} />
        <StatCard label="Training Backfill" value={`${trainingPct.toFixed(0)}%`} sub={`${r.total_training_rows.toLocaleString()} / ${r.total_training_target.toLocaleString()} rows`} tone={tone(trainingPct)} icon={<Database className="h-4 w-4" />} />
        <StatCard label="Eval Pass (avg)" value={`${r.avg_eval_pass_pct.toFixed(0)}%`} sub={`${r.total_fixtures.toLocaleString()} fixtures total`} tone={tone(r.avg_eval_pass_pct)} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Outcome-Eval Coverage" value={`${r.actions_outcome_full} / ${r.total_actions}`} sub={`${r.actions_no_evals} structural-only`} tone={r.actions_outcome_full >= 10 ? "good" : "warn"} icon={<Target className="h-4 w-4" />} />
        <StatCard label="HITL Burden / wk" value={`${r.total_human_hours_per_week.toFixed(0)}h`} sub={`${r.promotable_hours_per_week.toFixed(0)}h recoverable via Phase F`} tone="warn" icon={<Hourglass className="h-4 w-4" />} />
        <StatCard label="Zero-Fixture Actions" value={r.actions_zero_fixtures} sub={`Money-path: ${r.money_path_actions}`} tone={r.actions_zero_fixtures === 0 ? "good" : r.actions_zero_fixtures < 5 ? "warn" : "bad"} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <section className="mt-8 grid lg:grid-cols-3 gap-4">
        <div className="rounded-lg border border-card-border bg-card p-5 lg:col-span-2">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-semibold text-sm">Production Readiness Distribution</h3>
            <span className="text-xs text-muted-foreground">{actions.length} actions across 7 readiness buckets</span>
          </div>
          <div className="h-44 mt-2">
            <ResponsiveContainer>
              <BarChart data={distribution} margin={{ top: 4, right: 4, bottom: 4, left: -12 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} allowDecimals={false} />
                <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 6, fontSize: 12 }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {distribution.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-5">
          <div className="flex items-baseline justify-between mb-1">
            <h3 className="font-semibold text-sm">Avg progress by class</h3>
            <span className="text-xs text-muted-foreground">Sampling vs Paid Deal</span>
          </div>
          <div className="h-44 mt-2">
            <ResponsiveContainer>
              <BarChart data={byClass} margin={{ top: 4, right: 4, bottom: 4, left: -16 }}>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="cls" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 6, fontSize: 12 }} />
                <RLegend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Handler" fill="hsl(158 64% 38%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Training" fill="hsl(173 58% 45%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Eval" fill="hsl(43 74% 49%)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Prod" fill="hsl(217 33% 45%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-lg font-semibold">40-Action Heatmap</h2>
          <Legend />
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs font-medium text-muted-foreground mb-2">Sampling · 14 actions</div>
          <div className="grid grid-cols-7 gap-2 mb-5">{sampling.map((a) => <HeatCell key={a.action_name} a={a} />)}</div>
          <div className="text-xs font-medium text-muted-foreground mb-2">Paid Deal · 26 actions</div>
          <div className="grid grid-cols-7 lg:grid-cols-9 gap-2">{paid.map((a) => <HeatCell key={a.action_name} a={a} />)}</div>
        </div>
      </section>

      <section className="mt-8 grid lg:grid-cols-3 gap-6">
        <GapsToProductionSummary actions={actions} />
        <TrainingGapsSummary actions={actions} />
        <RecentFeed feed={feed} />
      </section>
    </Layout>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500/30 border border-emerald-500/50" /> ≥85%</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-500/30 border border-amber-500/50" /> 65-84%</span>
      <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-500/30 border border-rose-500/50" /> &lt;65%</span>
      <span className="ml-2 border-l border-border pl-3">Stripes: handler · training · evals</span>
    </div>
  );
}

function GapsToProductionSummary({ actions }: { actions: AutonomyAction[] }) {
  const ranked = [...actions].sort((a, b) => a.prod_readiness_pct - b.prod_readiness_pct).slice(0, 8);
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Furthest from Production</h3>
        <Link href="/actions" className="text-xs text-primary hover:underline">View all →</Link>
      </div>
      <ul className="space-y-2.5">
        {ranked.map((a) => (
          <li key={a.action_name}>
            <Link href={`/actions/${a.action_name}`} className="block hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded-md transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.display_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.gaps_to_prod[0] ?? "—"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold tabular-nums">{a.prod_readiness_pct}%</div>
                  <div className="text-[10px] text-muted-foreground uppercase">{a.class.replace("_", " ")}</div>
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TrainingGapsSummary({ actions }: { actions: AutonomyAction[] }) {
  const ranked = [...actions].sort((a, b) => a.training_backfill_pct - b.training_backfill_pct).slice(0, 8);
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Largest Training Gaps</h3>
        <Link href="/training" className="text-xs text-primary hover:underline">Workbench →</Link>
      </div>
      <ul className="space-y-2.5">
        {ranked.map((a) => (
          <li key={a.action_name}>
            <Link href={`/actions/${a.action_name}`} className="block hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded-md transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium truncate">{a.display_name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">{a.training_rows} / {a.training_target}</span>
              </div>
              <ProgressBar value={a.training_backfill_pct} tone={tone(a.training_backfill_pct)} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RecentFeed({ feed }: { feed: Feed | undefined }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2"><GitMerge className="h-4 w-4 text-muted-foreground" /> Recently Shipped</h3>
        <Link href="/issues" className="text-xs text-primary hover:underline">All issues →</Link>
      </div>
      {feed?.recent.slice(0, 8).map((f) => (
        <a
          key={f.number}
          href={`https://github.com/bemomentiq/momentiq-dna/pull/${f.number}`}
          target="_blank"
          rel="noreferrer"
          className="block hover:bg-accent/40 -mx-2 px-2 py-1.5 rounded-md transition-colors"
        >
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0">{f.date.slice(5)}</span>
            <span className="text-[10px] font-mono text-primary shrink-0">#{f.number}</span>
            <span className="text-xs truncate min-w-0 flex-1">{f.title}</span>
          </div>
        </a>
      ))}
    </div>
  );
}
