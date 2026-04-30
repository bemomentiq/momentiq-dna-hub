import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import type { RoadmapPhase, AutonomyAction } from "@/lib/types";
import { Link } from "wouter";
import { CheckCircle2, Circle, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_BADGE = {
  shipped: "text-emerald-600 dark:text-emerald-400",
  in_progress: "text-amber-600 dark:text-amber-400",
  open: "text-muted-foreground",
};

const STATUS_ICON = {
  shipped: CheckCircle2,
  in_progress: Clock,
  open: Circle,
};

export default function Roadmap() {
  const { data: phases = [] } = useQuery<RoadmapPhase[]>({ queryKey: ["/api/roadmap"] });
  const { data: actions = [] } = useQuery<AutonomyAction[]>({ queryKey: ["/api/actions"] });
  const actionMap = new Map(actions.map((a) => [a.action_name, a]));

  const totalItems = phases.reduce((s, p) => s + p.items.length, 0);
  const shipped = phases.reduce((s, p) => s + p.items.filter((i) => i.status === "shipped").length, 0);

  return (
    <Layout
      title="Roadmap to Full Autonomy"
      subtitle={`${shipped} of ${totalItems} milestones shipped · derived from FLEET tracker #3604 + per-action gap analysis`}
    >
      <div className="grid lg:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Overall Progress</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{Math.round((shipped / totalItems) * 100)}%</div>
          <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${(shipped / totalItems) * 100}%` }} />
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Phases</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{phases.length}</div>
          <div className="mt-1 text-xs text-muted-foreground">A → G · LLM wire-up through money-path shadow</div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-4">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Critical Path</div>
          <div className="mt-1 text-sm font-medium">Phase F gate flips</div>
          <div className="mt-0.5 text-xs text-muted-foreground">Promote 14 tina_review actions to auto once eval ≥ 95%</div>
        </div>
      </div>

      <div className="space-y-5">
        {phases.map((phase, idx) => {
          const phaseShipped = phase.items.filter((i) => i.status === "shipped").length;
          const pct = phase.items.length ? (phaseShipped / phase.items.length) * 100 : 0;
          return (
            <div key={phase.id} className="rounded-lg border border-card-border bg-card p-5">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground">{idx + 1}</span>
                    <h2 className="font-semibold">{phase.name}</h2>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1.5 max-w-3xl">{phase.description}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-muted-foreground uppercase">Done</div>
                  <div className="font-semibold tabular-nums">{phaseShipped} / {phase.items.length}</div>
                </div>
              </div>
              <div className="h-1 rounded-full bg-muted overflow-hidden mb-4">
                <div className={cn("h-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-primary")} style={{ width: `${pct}%` }} />
              </div>
              <ul className="divide-y divide-card-border">
                {phase.items.map((item) => {
                  const Icon = STATUS_ICON[item.status];
                  const action = item.action ? actionMap.get(item.action) : null;
                  return (
                    <li key={item.id} className="py-2.5 flex items-start gap-3">
                      <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", STATUS_BADGE[item.status])} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="font-mono text-[11px] text-muted-foreground uppercase">{item.id}</div>
                          <div className="flex items-center gap-2 text-xs">
                            {item.issue && (
                              <a
                                href={`https://github.com/bemomentiq/momentiq-dna/issues/${item.issue}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                              >
                                #{item.issue} <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                            <span className={cn("uppercase tracking-wide text-[10px]", STATUS_BADGE[item.status])}>{item.status.replace("_", " ")}</span>
                          </div>
                        </div>
                        <div className="text-sm">{item.title}</div>
                        {action && (
                          <Link href={`/actions/${action.action_name}`} className="text-xs text-primary hover:underline">
                            {action.display_name} →
                          </Link>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Layout>
  );
}
