import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import type { DataPipeline } from "@/lib/types";
import { Database, Filter, Layers, Activity, ArrowRight } from "lucide-react";

export default function DataPipelinePage() {
  const { data } = useQuery<DataPipeline>({ queryKey: ["/api/data-pipeline"] });

  if (!data) return <Layout title="Data Pipeline"><div className="text-muted-foreground">Loading…</div></Layout>;

  const max = data.funnel[0].value;

  return (
    <Layout
      title="Data Pipeline"
      subtitle="End-to-end flow from raw data sources → cleaning → fixtures → training rows → active eval corpus"
    >
      <section className="rounded-lg border border-card-border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold mb-4">Funnel</h2>
        <div className="space-y-3">
          {data.funnel.map((s, i) => {
            const w = (s.value / max) * 100;
            const lossFromPrev = i === 0 ? null : ((data.funnel[i - 1].value - s.value) / data.funnel[i - 1].value) * 100;
            return (
              <div key={s.stage}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <FunnelIcon stage={i} />
                    <span className="font-medium text-sm">{s.stage}</span>
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-xs tabular-nums text-muted-foreground">{lossFromPrev != null ? `−${lossFromPrev.toFixed(0)}% vs prev` : ""}</span>
                    <span className="font-semibold tabular-nums">{s.value.toLocaleString()}</span>
                  </div>
                </div>
                <div className="h-7 rounded bg-muted overflow-hidden">
                  <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(w, 2)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-4">
          Each step represents a real pipeline stage. <strong>Source rows</strong> are theoretical maximums in the data deep-dives. <strong>Cleaned + labeled</strong> is what's ingested into Neon. <strong>Backtest fixtures</strong> are curated cases bound to handlers. <strong>Eval corpus</strong> is the active set used in current eval runs.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-3">Sources by volume</h2>
        <div className="space-y-3">
          {data.sources.map((s) => (
            <div key={s.source} className="rounded-lg border border-card-border bg-card p-5">
              <div className="flex items-baseline justify-between gap-3 mb-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Database className="h-4 w-4 text-muted-foreground shrink-0" />
                  <h3 className="font-medium truncate">{s.source}</h3>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground shrink-0">~{s.total_rows.toLocaleString()} rows · {s.actions.length} action{s.actions.length === 1 ? "" : "s"}</span>
              </div>
              <div className="grid lg:grid-cols-2 gap-3 mt-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5"><Layers className="h-3 w-3" /> Feeds these actions</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.actions.slice(0, 8).map((a) => (
                      <a key={a.name} href={`/#/actions/${a.name}`} className="text-[11px] px-2 py-0.5 rounded border border-card-border bg-muted hover:bg-accent">
                        {a.display_name} <span className="text-muted-foreground">({a.rows.toLocaleString()})</span>
                      </a>
                    ))}
                    {s.actions.length > 8 && <span className="text-[11px] text-muted-foreground self-center">+{s.actions.length - 8} more</span>}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1.5"><Filter className="h-3 w-3" /> Cleaning steps (canonical)</div>
                  <ul className="space-y-0.5">
                    {Array.from(new Set(s.actions.flatMap((a) => a.cleaning))).slice(0, 5).map((c, i) => (
                      <li key={i} className="text-xs text-foreground/80 flex gap-1.5">
                        <span className="text-muted-foreground tabular-nums shrink-0">{i + 1}.</span>
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}

function FunnelIcon({ stage }: { stage: number }) {
  const icons = [Database, Filter, Layers, Activity];
  const Icon = icons[stage] ?? Database;
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}
