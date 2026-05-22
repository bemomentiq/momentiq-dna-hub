import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { AutonomyAction } from "@/lib/types";
import { Link } from "wouter";
import { Activity, AlertTriangle, RotateCcw, GaugeCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const EVAL_BADGE = {
  none: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  structural_only: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  outcome_partial: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  outcome_full: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

function tone(pct: number) {
  if (pct >= 85) return "good" as const;
  if (pct >= 65) return "warn" as const;
  return "bad" as const;
}

export default function Evals() {
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });

  const buckets = {
    none: actions.filter((a) => a.eval_status === "none"),
    structural_only: actions.filter((a) => a.eval_status === "structural_only"),
    outcome_partial: actions.filter((a) => a.eval_status === "outcome_partial"),
    outcome_full: actions.filter((a) => a.eval_status === "outcome_full"),
  };

  const avgPass = actions.filter((a) => a.eval_pass_pct != null).reduce((s, a) => s + (a.eval_pass_pct ?? 0), 0) / actions.filter((a) => a.eval_pass_pct != null).length;
  const totalFixtures = actions.reduce((s, a) => s + a.fixture_count, 0);
  const lowPass = actions.filter((a) => (a.eval_pass_pct ?? 0) < 90).sort((a, b) => (a.eval_pass_pct ?? 0) - (b.eval_pass_pct ?? 0));

  return (
    <Layout
      title="Evals"
      subtitle={`${totalFixtures.toLocaleString()} fixtures across ${actions.length} actions · avg pass rate ${avgPass.toFixed(0)}%`}
    >
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 mb-6">
        <div className="flex items-start gap-3">
          <GaugeCircle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400" />
          <div className="flex-1">
            <h3 className="font-semibold text-sm">Drift monitor + auto-retrain status</h3>
            <p className="text-xs text-muted-foreground mt-1">Phase E of the FLEET tracker — not yet shipped. Once active, every action gets a Page-Hinkley monitor on its eval distribution; ρ &lt; 0.80 triggers <code className="font-mono">auto_revert_rule</code>.</p>
            <div className="grid md:grid-cols-3 gap-3 mt-3">
              <div className="rounded-md bg-card border border-card-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Page-Hinkley wiring</div>
                <div className="text-sm font-medium mt-0.5">Open · <a href="https://github.com/bemomentiq/momentiq-dna/issues/3363" target="_blank" rel="noreferrer" className="text-primary hover:underline">#3363</a></div>
              </div>
              <div className="rounded-md bg-card border border-card-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Weekly retrain cron</div>
                <div className="text-sm font-medium mt-0.5">Open · <a href="https://github.com/bemomentiq/momentiq-dna/issues/3364" target="_blank" rel="noreferrer" className="text-primary hover:underline">#3364</a></div>
              </div>
              <div className="rounded-md bg-card border border-card-border p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Auto-rollback trigger</div>
                <div className="text-sm font-medium mt-0.5 flex items-center gap-1.5"><RotateCcw className="h-3 w-3" /> Open · ρ&lt;0.80</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <BucketCard label="No evals" count={buckets.none.length} desc="Action has zero tests" tone="bad" />
        <BucketCard label="Structural only" count={buckets.structural_only.length} desc="Type / wiring tests, no outcome reward" tone="warn" />
        <BucketCard label="Outcome partial" count={buckets.outcome_partial.length} desc="Outcome reward joined for some cases" tone="default" />
        <BucketCard label="Outcome full" count={buckets.outcome_full.length} desc="D+14 reward join + drift monitor" tone="good" />
      </div>

      <section className="mb-8">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" /> Below 90% Pass — Priority Backlog</h2>
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground tracking-wide">
              <tr>
                <th className="text-left px-4 py-2.5">Action</th>
                <th className="text-right px-4 py-2.5">Pass</th>
                <th className="text-right px-4 py-2.5">Corpus</th>
                <th className="text-left px-4 py-2.5">Status</th>
                <th className="text-left px-4 py-2.5">Suggested Eval to Add</th>
              </tr>
            </thead>
            <tbody>
              {lowPass.map((a) => (
                <tr key={a.action_name} className="border-t border-card-border hover:bg-accent/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/actions/${a.action_name}`} className="font-medium hover:text-primary">{a.display_name}</Link>
                    <div className="text-[11px] text-muted-foreground font-mono">{a.action_name}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="tabular-nums text-xs">{a.eval_pass_pct ?? "—"}{a.eval_pass_pct ? "%" : ""}</span>
                      <div className="w-12"><ProgressBar value={a.eval_pass_pct ?? 0} tone={tone(a.eval_pass_pct ?? 0)} /></div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-xs">{a.eval_corpus_size}</td>
                  <td className="px-4 py-2.5"><span className={cn("text-[11px] px-1.5 py-0.5 rounded", EVAL_BADGE[a.eval_status])}>{a.eval_status.replace("_", " ")}</span></td>
                  <td className="px-4 py-2.5 text-xs font-mono">{a.suggested_evals[0] ?? "—"}</td>
                </tr>
              ))}
              {lowPass.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">All actions ≥ 90% pass. Push toward outcome-full.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Activity className="h-4 w-4" /> Suggested New Evals</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {actions.flatMap((a) => a.suggested_evals.map((e) => ({ a, e }))).slice(0, 30).map(({ a, e }, i) => (
            <Link
              key={i}
              href={`/actions/${a.action_name}`}
              className="rounded-lg border border-card-border bg-card p-3.5 hover:border-primary/40 transition-colors block"
            >
              <div className="text-xs text-muted-foreground mb-1">{a.display_name}</div>
              <div className="text-sm font-mono">{e}</div>
            </Link>
          ))}
        </div>
      </section>
    </Layout>
  );
}

function BucketCard({ label, count, desc, tone }: { label: string; count: number; desc: string; tone: "good" | "warn" | "bad" | "default" }) {
  const ring = {
    good: "border-emerald-500/40",
    warn: "border-amber-500/40",
    bad: "border-rose-500/40",
    default: "border-sky-500/40",
  }[tone];
  return (
    <div className={cn("rounded-lg border bg-card p-4", ring)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}
