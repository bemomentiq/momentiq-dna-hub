import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { AutonomyAction } from "@/lib/types";
import { Link } from "wouter";
import { DollarSign, Shield, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export default function MoneyPath() {
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/money-path"] });

  if (actions.length === 0) return <Layout title="Money Path"><div className="text-muted-foreground">Loading…</div></Layout>;

  const avgReady = actions.reduce((s, a) => s + a.prod_readiness_pct, 0) / actions.length;
  const avgEval = actions.reduce((s, a) => s + (a.eval_pass_pct ?? 0), 0) / actions.length;

  return (
    <Layout
      title="Money Path"
      subtitle="5 actions that move dollars. Maximum scrutiny: ALEX kill-switch, money-path tag, no L1 promotion until 30-day shadow eval."
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Money-path actions" value={actions.length} icon={<DollarSign className="h-4 w-4" />} />
        <Stat label="Avg prod readiness" value={`${avgReady.toFixed(0)}%`} icon={<Shield className="h-4 w-4" />} />
        <Stat label="Avg eval pass" value={`${avgEval.toFixed(0)}%`} />
        <Stat label="HITL gate" value="tina_review" sub="ALEX kill-switch on auto-revert" tone="warn" />
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 mb-6 flex items-start gap-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
        <div className="text-sm">
          <div className="font-semibold">Money-path policy</div>
          <p className="text-muted-foreground mt-1">No money-path action graduates from L0 → L1 until: (1) handler at 100% wired, (2) backtest fixtures ≥ 100 cases, (3) 30-day shadow eval at ≥ 99% precision against ledger, (4) ALEX kill-switch tested. Tina_review remains in place even at L1.</p>
        </div>
      </div>

      <div className="space-y-3">
        {actions.sort((a, b) => a.action_number - b.action_number).map((a) => {
          const ext = a.extras!;
          return (
            <Link key={a.action_name} href={`/actions/${a.action_name}`} className="block rounded-lg border border-card-border bg-card p-5 hover:border-primary/30 transition-colors">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 uppercase tracking-wide">money path</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">PD #{a.action_number}</span>
                    <span className="font-semibold">{a.display_name}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{a.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-2xl font-semibold tabular-nums">{a.prod_readiness_pct}%</div>
                  <div className="text-[10px] text-muted-foreground uppercase">prod ready</div>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                <Mini label="Handler" value={`${a.handler_pct}%`} pct={a.handler_pct} />
                <Mini label="Fixtures" value={`${a.fixture_count}`} pct={a.fixtures_pct} />
                <Mini label="Training" value={`${a.training_rows}/${a.training_target}`} pct={a.training_backfill_pct} />
                <Mini label="Eval pass" value={a.eval_pass_pct ? `${a.eval_pass_pct}%` : "—"} pct={a.eval_pass_pct ?? 0} />
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Run cost</div>
                  <div className="font-semibold tabular-nums">${ext.p95_cost_budget_usd}</div>
                  <div className="text-[10px] text-muted-foreground">SLA p95 {ext.p95_sla_ms}ms</div>
                </div>
              </div>

              {a.gaps_to_prod.length > 0 && (
                <div className="mt-3 pt-3 border-t border-card-border">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Top gap</div>
                  <div className="text-sm">{a.gaps_to_prod[0]}</div>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </Layout>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode; tone?: "warn" }) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", tone === "warn" ? "border-amber-500/40" : "border-card-border")}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="mt-1"><ProgressBar value={pct} tone={pct >= 85 ? "good" : pct >= 65 ? "warn" : "bad"} /></div>
    </div>
  );
}
