import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { AutonomyAction } from "@/lib/types";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { Database, Filter } from "lucide-react";
import { cn } from "@/lib/utils";

function tone(pct: number) {
  if (pct >= 85) return "good" as const;
  if (pct >= 65) return "warn" as const;
  return "bad" as const;
}

export default function TrainingWorkbench() {
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Aggregate sources
  const sourceAgg = useMemo(() => {
    const map = new Map<string, { source: string; rows: number; actions: { name: string; display: string; rows: number }[]; cleaning: Set<string> }>();
    actions.forEach((a) => {
      a.data_sources.forEach((s) => {
        const key = s.source;
        if (!map.has(key)) map.set(key, { source: key, rows: 0, actions: [], cleaning: new Set() });
        const e = map.get(key)!;
        e.rows += s.estimated_rows;
        e.actions.push({ name: a.action_name, display: a.display_name, rows: s.estimated_rows });
        s.cleaning_steps.forEach((c) => e.cleaning.add(c));
      });
    });
    return Array.from(map.values()).sort((a, b) => b.rows - a.rows);
  }, [actions]);

  const totalRows = actions.reduce((s, a) => s + a.training_rows, 0);
  const totalTarget = actions.reduce((s, a) => s + a.training_target, 0);
  const totalGap = totalTarget - totalRows;

  const ranked = [...actions].sort((a, b) => (a.training_target - a.training_rows) - (b.training_target - b.training_rows)).reverse();

  const filteredActions = sourceFilter === "all" ? ranked : ranked.filter((a) => a.data_sources.some((s) => s.source === sourceFilter));

  return (
    <Layout
      title="Training Data Workbench"
      subtitle={`${totalRows.toLocaleString()} of ${totalTarget.toLocaleString()} target rows backfilled · ${totalGap.toLocaleString()} rows of work remaining across all 40 actions`}
    >
      <div className="grid lg:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Backfill progress</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{((totalRows / totalTarget) * 100).toFixed(0)}%</div>
          <div className="mt-2"><ProgressBar value={(totalRows / totalTarget) * 100} tone={tone((totalRows / totalTarget) * 100)} /></div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Actions ≥ 80% trained</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{actions.filter((a) => a.training_backfill_pct >= 80).length} / {actions.length}</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Distinct data sources</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{sourceAgg.length}</div>
        </div>
      </div>

      <section className="mb-8">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold">Discovered Data Sources</h2>
          <span className="text-xs text-muted-foreground">Click a source to filter actions →</span>
        </div>
        <div className="grid md:grid-cols-2 gap-3">
          <SourceCard active={sourceFilter === "all"} onClick={() => setSourceFilter("all")} title="All sources" rows={sourceAgg.reduce((s, x) => s + x.rows, 0)} actionCount={actions.length} />
          {sourceAgg.map((s) => (
            <SourceCard
              key={s.source}
              active={sourceFilter === s.source}
              onClick={() => setSourceFilter(s.source)}
              title={s.source}
              rows={s.rows}
              actionCount={s.actions.length}
              cleaning={Array.from(s.cleaning).slice(0, 3)}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold">Backfill Plan by Action</h2>
          {sourceFilter !== "all" && (
            <button onClick={() => setSourceFilter("all")} className="text-xs text-primary hover:underline">
              <Filter className="h-3 w-3 inline mr-1" /> Clear filter ({sourceFilter})
            </button>
          )}
        </div>
        <div className="space-y-2">
          {filteredActions.map((a) => {
            const gap = a.training_target - a.training_rows;
            return (
              <Link
                key={a.action_name}
                href={`/actions/${a.action_name}`}
                className="block rounded-lg border border-card-border bg-card p-4 hover:border-primary/40 transition-colors"
                data-testid={`backfill-row-${a.action_name}`}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-medium">{a.display_name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">{a.class.replace("_", " ")}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{a.action_name}</span>
                    </div>
                    {a.gaps_to_training[0] && (
                      <div className="text-xs text-muted-foreground mt-0.5">{a.gaps_to_training[0]}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm tabular-nums">
                      <span className="font-semibold">{a.training_rows.toLocaleString()}</span>
                      <span className="text-muted-foreground"> / {a.training_target.toLocaleString()}</span>
                    </div>
                    <div className="text-[11px] text-rose-600 dark:text-rose-400">
                      {gap > 0 ? `+${gap.toLocaleString()} needed` : "complete"}
                    </div>
                  </div>
                </div>
                <div className="mt-2"><ProgressBar value={a.training_backfill_pct} tone={tone(a.training_backfill_pct)} /></div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {a.data_sources.map((s, i) => (
                    <span key={i} className={cn(
                      "text-[10px] px-1.5 py-0.5 rounded border",
                      sourceFilter === s.source ? "bg-primary/10 border-primary/30 text-primary" : "bg-muted border-card-border text-muted-foreground"
                    )}>
                      {s.source.split("(")[0].trim()} · ~{s.estimated_rows.toLocaleString()}
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </Layout>
  );
}

function SourceCard({ active, onClick, title, rows, actionCount, cleaning }: { active: boolean; onClick: () => void; title: string; rows: number; actionCount: number; cleaning?: string[] }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full min-w-0 text-left rounded-lg border p-4 transition-all",
        active ? "border-primary bg-primary/5" : "border-card-border bg-card hover:border-primary/30"
      )}
    >
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{title}</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0">~{rows.toLocaleString()}</span>
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{actionCount} action{actionCount === 1 ? "" : "s"}</div>
      {cleaning && cleaning.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {cleaning.map((c, i) => (
            <li key={i} className="text-[11px] text-foreground/80 truncate">· {c}</li>
          ))}
        </ul>
      )}
    </button>
  );
}
