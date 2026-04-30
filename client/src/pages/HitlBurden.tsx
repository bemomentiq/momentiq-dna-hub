import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { HitlBurden } from "@/lib/types";
import { Link } from "wouter";
import { Hourglass, Zap, Lock } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid, Cell } from "recharts";
import { cn } from "@/lib/utils";

export default function HitlBurdenPage() {
  const { data: rows = [] } = useQuery<HitlBurden[]>({ queryKey: ["/api/hitl-burden"] });

  const sorted = [...rows].sort((a, b) => b.hours_per_week - a.hours_per_week);
  const totalHrs = rows.reduce((s, x) => s + x.hours_per_week, 0);
  const tinaHrs = rows.filter((x) => x.hitl_gate === "tina_review").reduce((s, x) => s + x.hours_per_week, 0);
  const alexHrs = rows.filter((x) => x.hitl_gate === "alex_decision").reduce((s, x) => s + x.hours_per_week, 0);
  const promotable = sorted.filter((x) => x.promotable);
  const promotableHrs = promotable.reduce((s, x) => s + x.hours_per_week, 0);

  const top10 = sorted.slice(0, 10).map((x) => ({
    name: x.display_name.length > 22 ? x.display_name.slice(0, 22) + "…" : x.display_name,
    Recoverable: x.promotable ? Math.round(x.hours_per_week * 10) / 10 : 0,
    Required: !x.promotable ? Math.round(x.hours_per_week * 10) / 10 : 0,
    fullName: x.display_name,
    actionName: x.action_name,
  }));

  return (
    <Layout
      title="HITL Burden"
      subtitle="Weekly human-review hours per action across 37 active brands. Promotable means eval pass ≥ 90% — flippable to auto with shadow eval."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Total HITL hrs/wk" value={`${totalHrs.toFixed(0)}h`} icon={<Hourglass className="h-4 w-4" />} />
        <Stat label="Tina_review" value={`${tinaHrs.toFixed(0)}h`} sub="reviewable on AI Training page" />
        <Stat label="Alex kill-switch" value={`${alexHrs.toFixed(0)}h`} sub="founder approval — keep gated" icon={<Lock className="h-4 w-4" />} />
        <Stat label="Recoverable" value={`${promotableHrs.toFixed(0)}h`} sub={`${promotable.length} actions ready to flip`} icon={<Zap className="h-4 w-4" />} tone="good" />
      </div>

      <section className="rounded-lg border border-card-border bg-card p-5 mb-6">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-semibold text-sm">Top 10 actions by HITL hours / week</h3>
          <span className="text-xs text-muted-foreground">green = recoverable on flip</span>
        </div>
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={top10} layout="vertical" margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
              <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} width={180} />
              <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.4)" }} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", borderRadius: 6, fontSize: 12 }} />
              <Bar dataKey="Recoverable" stackId="hrs" fill="hsl(158 64% 38%)" radius={[0, 4, 4, 0]} />
              <Bar dataKey="Required" stackId="hrs" fill="hsl(43 74% 49%)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <h3 className="font-semibold text-sm mb-3">Promotable actions ({promotable.length})</h3>
      <div className="rounded-lg border border-card-border bg-card overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Action</th>
              <th className="text-right px-4 py-2.5 font-medium">Runs/wk</th>
              <th className="text-right px-4 py-2.5 font-medium">Min/run</th>
              <th className="text-right px-4 py-2.5 font-medium">Hrs/wk</th>
              <th className="text-right px-4 py-2.5 font-medium">Eval pass</th>
              <th className="text-right px-4 py-2.5 font-medium">Prod ready</th>
            </tr>
          </thead>
          <tbody>
            {promotable.map((x) => (
              <tr key={x.action_name} className="border-t border-card-border hover:bg-accent/30">
                <td className="px-4 py-2.5">
                  <Link href={`/actions/${x.action_name}`} className="font-medium hover:text-primary">{x.display_name}</Link>
                  <div className="text-[11px] font-mono text-muted-foreground">{x.action_name}</div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.weekly_runs.toFixed(0)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.minutes_per_run}</td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{x.hours_per_week.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.eval_pass_pct}%</td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="tabular-nums text-xs">{x.prod_readiness_pct}%</span>
                    <div className="w-12"><ProgressBar value={x.prod_readiness_pct} tone={x.prod_readiness_pct >= 85 ? "good" : "warn"} /></div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="font-semibold text-sm mb-3">All HITL-gated actions</h3>
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Action</th>
              <th className="text-left px-4 py-2.5 font-medium">Gate</th>
              <th className="text-right px-4 py-2.5 font-medium">Hrs/wk</th>
              <th className="text-right px-4 py-2.5 font-medium">Eval</th>
              <th className="text-left px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.filter((x) => x.hitl_gate !== "auto").map((x) => (
              <tr key={x.action_name} className="border-t border-card-border hover:bg-accent/30">
                <td className="px-4 py-2.5"><Link href={`/actions/${x.action_name}`} className="font-medium hover:text-primary">{x.display_name}</Link></td>
                <td className="px-4 py-2.5"><span className={cn("text-[11px] px-1.5 py-0.5 rounded border", x.hitl_gate === "alex_decision" ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400" : "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400")}>{x.hitl_gate}</span></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.hours_per_week.toFixed(1)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{x.eval_pass_pct ?? "—"}{x.eval_pass_pct ? "%" : ""}</td>
                <td className="px-4 py-2.5">
                  {x.hitl_gate === "alex_decision" ? (
                    <span className="text-xs text-muted-foreground">Founder gate · keep</span>
                  ) : x.promotable ? (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400">Promotable</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Needs eval ≥ 90%</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode; tone?: "good" }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", tone === "good" ? "border-emerald-500/40" : "border-card-border")}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
