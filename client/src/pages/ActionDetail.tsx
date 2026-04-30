import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { ProgressBar, StatCard } from "@/components/StatCard";
import type { AutonomyAction } from "@/lib/types";
import { ArrowLeft, ExternalLink, FileCode, AlertCircle, Database, Wrench, Activity, ArrowRight, GitBranch, Clock, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";

function tone(pct: number) {
  if (pct >= 85) return "good" as const;
  if (pct >= 65) return "warn" as const;
  return "bad" as const;
}

export default function ActionDetail() {
  const [, params] = useRoute("/actions/:name");
  const name = params?.name;
  const { data: a, isLoading } = useQuery<AutonomyAction>({ queryKey: ["/api/actions", name], enabled: !!name });
  const { data: allActions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });

  if (isLoading) return <Layout title="Loading…"><div className="text-muted-foreground">Loading…</div></Layout>;
  if (!a) return <Layout title="Not Found"><div className="text-muted-foreground">Action not found.</div></Layout>;

  const ext = a.extras!;
  const findAction = (n: string) => allActions.find((x) => x.action_name === n);
  const upstream = ext.upstream.map(findAction).filter(Boolean) as AutonomyAction[];
  const downstream = ext.downstream.map(findAction).filter(Boolean) as AutonomyAction[];
  const sisters = ext.sister_actions.map(findAction).filter(Boolean) as AutonomyAction[];

  return (
    <Layout
      title={a.display_name}
      subtitle={a.description}
      actions={
        <Link href="/actions" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="link-back">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to All Actions
        </Link>
      }
    >
      <div className="flex flex-wrap gap-2 mb-5">
        <Badge label="action_name" value={a.action_name} mono />
        <Badge label="class" value={a.class.replace("_", " ")} />
        <Badge label="position" value={`#${a.action_number}`} />
        <Badge label="HITL" value={a.hitl_gate} />
        <Badge label="autonomy" value={a.autonomy_level} />
        <Badge label="handler" value={a.handler_file} mono />
        {ext.money_path && <Badge label="money path" value="yes" tone="warn" />}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <StatCard label="Prod Readiness" value={`${a.prod_readiness_pct}%`} sub={<ProgressBar value={a.prod_readiness_pct} tone={tone(a.prod_readiness_pct)} />} tone={tone(a.prod_readiness_pct)} />
        <StatCard label="Handler" value={`${a.handler_pct}%`} sub={<ProgressBar value={a.handler_pct} tone={tone(a.handler_pct)} />} tone={tone(a.handler_pct)} />
        <StatCard label="Training" value={`${a.training_backfill_pct}%`} sub={`${a.training_rows} / ${a.training_target} rows`} tone={tone(a.training_backfill_pct)} />
        <StatCard label="Fixtures" value={a.fixture_count} sub={`${a.fixtures_pct}% coverage`} tone={tone(a.fixtures_pct)} />
        <StatCard label="Eval Pass" value={a.eval_pass_pct != null ? `${a.eval_pass_pct}%` : "—"} sub={`${a.eval_corpus_size} cases · ${a.eval_status.replace("_", " ")}`} tone={tone(a.eval_pass_pct ?? 0)} />
      </div>

      <section className="mt-5 grid lg:grid-cols-3 gap-3">
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><Clock className="h-3 w-3" /> Latency budget</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{ext.p95_sla_ms.toLocaleString()} ms</div>
          <div className="text-xs text-muted-foreground">p95 SLA from cos_action_registry</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5"><DollarSign className="h-3 w-3" /> Cost budget per run</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">${ext.p95_cost_budget_usd.toFixed(2)}</div>
          <div className="text-xs text-muted-foreground">LLM call + tool budget</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Throughput</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{ext.weekly_runs_per_brand} <span className="text-sm text-muted-foreground font-normal">/ brand / wk</span></div>
          <div className="text-xs text-muted-foreground">{(ext.weekly_runs_per_brand * 37).toFixed(0)} runs/wk across 37 active brands</div>
        </div>
      </section>

      {(upstream.length + downstream.length + sisters.length) > 0 && (
        <section className="mt-6 rounded-lg border border-card-border bg-card p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><GitBranch className="h-4 w-4 text-muted-foreground" /> Workflow neighbors</h3>
          <div className="grid lg:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Upstream</div>
              {upstream.length ? (
                <div className="space-y-1">
                  {upstream.map((x) => (
                    <Link key={x.action_name} href={`/actions/${x.action_name}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted hover:bg-accent">
                      <span className="text-sm truncate">{x.display_name}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    </Link>
                  ))}
                </div>
              ) : <span className="text-xs text-muted-foreground italic">none</span>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Sister actions</div>
              {sisters.length ? (
                <div className="space-y-1">
                  {sisters.map((x) => (
                    <Link key={x.action_name} href={`/actions/${x.action_name}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted hover:bg-accent">
                      <span className="text-sm truncate">{x.display_name}</span>
                    </Link>
                  ))}
                </div>
              ) : <span className="text-xs text-muted-foreground italic">none</span>}
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Downstream</div>
              {downstream.length ? (
                <div className="space-y-1">
                  {downstream.map((x) => (
                    <Link key={x.action_name} href={`/actions/${x.action_name}`} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-muted hover:bg-accent">
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate">{x.display_name}</span>
                    </Link>
                  ))}
                </div>
              ) : <span className="text-xs text-muted-foreground italic">none</span>}
            </div>
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <Section title="Gaps to Production-Ready Autonomy" icon={<AlertCircle className="h-4 w-4" />} empty="No gaps — production-ready">
          {a.gaps_to_prod.map((g, i) => (
            <li key={i} className="flex gap-2 py-1.5 border-b border-card-border last:border-0">
              <span className="text-muted-foreground shrink-0">{i + 1}.</span>
              <span>{g}</span>
            </li>
          ))}
        </Section>

        <Section title="Gaps to Fully Trained" icon={<Database className="h-4 w-4" />} empty="Training corpus complete">
          {a.gaps_to_training.map((g, i) => (
            <li key={i} className="flex gap-2 py-1.5 border-b border-card-border last:border-0">
              <span className="text-muted-foreground shrink-0">{i + 1}.</span>
              <span>{g}</span>
            </li>
          ))}
        </Section>

        <Section title="Wiring Plan" icon={<Wrench className="h-4 w-4" />} empty="No further wiring needed">
          {a.wiring_plan.map((w, i) => (
            <li key={i} className="flex gap-2 py-1.5 border-b border-card-border last:border-0">
              <span className="text-primary font-mono shrink-0">→</span>
              <span>{w}</span>
            </li>
          ))}
        </Section>

        <Section title="Suggested Evals" icon={<Activity className="h-4 w-4" />} empty="No new evals suggested">
          {a.suggested_evals.map((e, i) => (
            <li key={i} className="flex gap-2 py-1.5 border-b border-card-border last:border-0">
              <span className="text-muted-foreground shrink-0">✓</span>
              <span className="font-mono text-[13px]">{e}</span>
            </li>
          ))}
        </Section>
      </div>

      {ext.timeline && ext.timeline.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> Handler timeline</h2>
          <div className="rounded-lg border border-card-border bg-card p-5">
            <ol className="relative border-l border-card-border ml-2 space-y-4">
              {ext.timeline.map((t, i) => (
                <li key={i} className="ml-4">
                  <span className="absolute -left-[5px] w-2.5 h-2.5 rounded-full bg-primary border-2 border-card" />
                  <div className="text-xs font-mono text-muted-foreground">{t.date}</div>
                  <div className="text-sm">{t.label}</div>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold mb-3">Where to Find More Training Data</h2>
        <div className="space-y-3">
          {a.data_sources.map((s, i) => (
            <div key={i} className="rounded-lg border border-card-border bg-card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="font-medium">{s.source}</h3>
                <span className="text-xs tabular-nums text-muted-foreground">~{s.estimated_rows.toLocaleString()} rows</span>
              </div>
              <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
              <div className="mt-3">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Cleaning steps</div>
                <ol className="space-y-1">
                  {s.cleaning_steps.map((step, j) => (
                    <li key={j} className="text-sm text-foreground/90 flex gap-2">
                      <span className="text-muted-foreground tabular-nums shrink-0">{j + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>
      </section>

      {a.github_issues.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold mb-3">Linked GitHub Issues</h2>
          <div className="flex flex-wrap gap-2">
            {a.github_issues.map((n) => (
              <a key={n} href={`https://github.com/bemomentiq/momentiq-dna/issues/${n}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-card-border bg-card text-sm hover:bg-accent transition-colors" data-testid={`link-issue-${n}`}>
                <FileCode className="h-3.5 w-3.5 text-muted-foreground" /> #{n} <ExternalLink className="h-3 w-3 text-muted-foreground" />
              </a>
            ))}
          </div>
        </section>
      )}
    </Layout>
  );
}

function Badge({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "warn" }) {
  return (
    <div className={cn("inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border", tone === "warn" ? "border-amber-500/30 bg-amber-500/10" : "border-card-border bg-card")}>
      <span className="text-muted-foreground uppercase tracking-wide text-[10px]">{label}</span>
      <span className={cn("font-medium", mono && "font-mono text-[11px]")}>{value}</span>
    </div>
  );
}

function Section({ title, icon, children, empty }: { title: string; icon: React.ReactNode; children: React.ReactNode; empty: string }) {
  const arr = Array.isArray(children) ? children : [children];
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      {arr.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">{empty}</div>
      ) : (
        <ul className="text-sm space-y-0">{children}</ul>
      )}
    </div>
  );
}
