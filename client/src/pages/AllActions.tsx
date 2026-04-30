import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ProgressBar } from "@/components/StatCard";
import type { AutonomyAction } from "@/lib/types";
import { Link } from "wouter";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

function tone(pct: number) {
  if (pct >= 85) return "good" as const;
  if (pct >= 65) return "warn" as const;
  return "bad" as const;
}

const HITL_BADGE = {
  auto: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  tina_review: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  alex_decision: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
};

const CLASS_BADGE = {
  sampling: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  paid_deal: "bg-violet-500/15 text-violet-700 dark:text-violet-400 border-violet-500/30",
};

const EVAL_BADGE = {
  none: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  structural_only: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  outcome_partial: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  outcome_full: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
};

type SortKey = "action_number" | "prod_readiness_pct" | "training_backfill_pct" | "eval_pass_pct" | "fixture_count";

export default function AllActions() {
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });
  const [q, setQ] = useState("");
  const [classFilter, setClassFilter] = useState<"all" | "sampling" | "paid_deal">("all");
  const [hitlFilter, setHitlFilter] = useState<"all" | "auto" | "tina_review" | "alex_decision">("all");
  const [evalFilter, setEvalFilter] = useState<"all" | "none" | "structural_only" | "outcome_partial" | "outcome_full">("all");
  const [sortKey, setSortKey] = useState<SortKey>("action_number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    let list = actions;
    if (classFilter !== "all") list = list.filter((a) => a.class === classFilter);
    if (hitlFilter !== "all") list = list.filter((a) => a.hitl_gate === hitlFilter);
    if (evalFilter !== "all") list = list.filter((a) => a.eval_status === evalFilter);
    if (q.trim()) {
      const ql = q.toLowerCase();
      list = list.filter((a) => a.action_name.includes(ql) || a.display_name.toLowerCase().includes(ql));
    }
    list = [...list].sort((a, b) => {
      const av = (a[sortKey] as number) ?? 0;
      const bv = (b[sortKey] as number) ?? 0;
      // For action_number, also respect class for natural ordering
      if (sortKey === "action_number") {
        if (a.class !== b.class) return a.class === "sampling" ? -1 : 1;
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return list;
  }, [actions, q, classFilter, hitlFilter, evalFilter, sortKey, sortDir]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  }

  const sortIndicator = (k: SortKey) => sortKey === k ? (sortDir === "asc" ? " ↑" : " ↓") : "";

  return (
    <Layout
      title="All Actions"
      subtitle={`${filtered.length} of ${actions.length} canonical actions`}
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <FilterPills label="Class" value={classFilter} options={[["all", "All"], ["sampling", "Sampling"], ["paid_deal", "Paid"]]} onChange={setClassFilter} />
          <FilterPills label="Gate" value={hitlFilter} options={[["all", "All"], ["auto", "auto"], ["tina_review", "tina"], ["alex_decision", "alex"]]} onChange={setHitlFilter} />
          <FilterPills label="Evals" value={evalFilter} options={[["all", "All"], ["structural_only", "struct"], ["outcome_partial", "partial"], ["outcome_full", "full"]]} onChange={setEvalFilter} />
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-8 h-8 w-44 text-sm" data-testid="input-search-actions" />
          </div>
          <a href="/api/actions.csv" download className="text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors">CSV</a>
        </div>
      }
    >
      <div className="rounded-lg border border-card-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("action_number")}>#{sortIndicator("action_number")}</th>
              <th className="text-left px-4 py-2.5 font-medium">Action</th>
              <th className="text-left px-4 py-2.5 font-medium">Class</th>
              <th className="text-left px-4 py-2.5 font-medium">HITL</th>
              <th className="text-left px-4 py-2.5 font-medium">Lvl</th>
              <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("prod_readiness_pct")}>Prod{sortIndicator("prod_readiness_pct")}</th>
              <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("training_backfill_pct")}>Train{sortIndicator("training_backfill_pct")}</th>
              <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("fixture_count")}>Fixtures{sortIndicator("fixture_count")}</th>
              <th className="text-right px-4 py-2.5 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort("eval_pass_pct")}>Eval{sortIndicator("eval_pass_pct")}</th>
              <th className="text-left px-4 py-2.5 font-medium">Eval Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.action_name} className="border-t border-card-border hover:bg-accent/30">
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                  {a.class === "sampling" ? "S" : "P"}{a.action_number}
                </td>
                <td className="px-4 py-2.5">
                  <Link href={`/actions/${a.action_name}`} className="font-medium hover:text-primary" data-testid={`link-action-${a.action_name}`}>
                    {a.display_name}
                  </Link>
                  <div className="text-[11px] text-muted-foreground font-mono">{a.action_name}</div>
                </td>
                <td className="px-4 py-2.5"><span className={cn("text-[11px] px-1.5 py-0.5 rounded border", CLASS_BADGE[a.class])}>{a.class.replace("_", " ")}</span></td>
                <td className="px-4 py-2.5"><span className={cn("text-[11px] px-1.5 py-0.5 rounded border", HITL_BADGE[a.hitl_gate])}>{a.hitl_gate}</span></td>
                <td className="px-4 py-2.5"><span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-muted">{a.autonomy_level}</span></td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="tabular-nums text-xs">{a.prod_readiness_pct}%</span>
                    <div className="w-12"><ProgressBar value={a.prod_readiness_pct} tone={tone(a.prod_readiness_pct)} /></div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <span className="tabular-nums text-xs">{a.training_backfill_pct}%</span>
                    <div className="w-12"><ProgressBar value={a.training_backfill_pct} tone={tone(a.training_backfill_pct)} /></div>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">{a.fixture_count}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-xs">{a.eval_pass_pct ?? "—"}{a.eval_pass_pct ? "%" : ""}</td>
                <td className="px-4 py-2.5"><span className={cn("text-[11px] px-1.5 py-0.5 rounded", EVAL_BADGE[a.eval_status])}>{a.eval_status.replace("_", " ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Layout>
  );
}

function FilterPills<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex border border-input rounded-md overflow-hidden text-xs">
        {options.map(([v, lbl]) => (
          <button key={v} onClick={() => onChange(v)} className={cn("px-2.5 py-1 transition-colors", value === v ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>{lbl}</button>
        ))}
      </div>
    </div>
  );
}
