import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import type { DraftTask, CronConfig } from "@/lib/types";
import { useState, useMemo, useEffect } from "react";
import { Rocket, Archive, Copy, Check, AlertCircle, ExternalLink, Trash2, Github, Layers, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

const PRIORITY_BADGE = {
  p0: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  p1: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  p2: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  p3: "bg-muted text-muted-foreground border-card-border",
};

const STATUS_BADGE: Record<string, string> = {
  proposed: "bg-muted text-muted-foreground",
  accepted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  dismissed: "bg-muted text-muted-foreground line-through",
  shipped: "bg-primary/15 text-primary",
  superseded: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
};

export default function Backlog() {
  const queryClient = useQueryClient();
  const { data: drafts = [] } = useQuery<DraftTask[]>({ queryKey: ["/api/draft-tasks"] });
  const { data: cfg } = useQuery<CronConfig>({ queryKey: ["/api/cron-config"] });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "proposed" | "accepted" | "shipped" | "dismissed" | "superseded">("all");
  const [shipResult, setShipResult] = useState<string>("");

  const filtered = useMemo(() => filter === "all" ? drafts : drafts.filter((d) => d.status === filter), [drafts, filter]);

  // Group by batch_id
  const batches = useMemo(() => {
    const m = new Map<string, DraftTask[]>();
    filtered.forEach((d) => {
      const k = d.batch_id ?? `solo-${d.id}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(d);
    });
    return Array.from(m.entries()).sort(([, a], [, b]) => (b[0]?.id ?? 0) - (a[0]?.id ?? 0));
  }, [filtered]);

  const ship = useMutation({
    mutationFn: async (ids: number[]) => {
      const r = await apiRequest("POST", "/api/draft-tasks/ship", { ids });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "ship failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setShipResult(`Shipped ${data.shipped} tasks to Command Center`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/stats"] });
      setTimeout(() => setShipResult(""), 6000);
    },
    onError: (err: any) => setShipResult(`Ship failed: ${err.message}`),
  });

  const syncGh = useMutation({
    mutationFn: async ({ ids, merge }: { ids: number[]; merge: boolean }) => {
      const r = await apiRequest("POST", "/api/draft-tasks/sync-github", { ids, merge });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "sync failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      const created = data.results.filter((r: any) => r.ok && r.gh?.number && r.error !== "already_synced" && !String(r.error).startsWith("merged_into:")).length;
      const merged = data.results.filter((r: any) => String(r.error).startsWith("merged_into:")).length;
      setShipResult(`GitHub sync: ${created} new issue${created === 1 ? "" : "s"} created${merged ? `, ${merged} merged into batch masters` : ""}`);
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] });
      setTimeout(() => setShipResult(""), 8000);
    },
    onError: (err: any) => setShipResult(`GH sync failed: ${err.message}`),
  });

  const syncAll = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/draft-tasks/sync-github-all", { merge: true });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "sync failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setShipResult(`Backfilled ${data.count ?? 0} tasks to GitHub${data.message ? " — " + data.message : ""}`);
      queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] });
      setTimeout(() => setShipResult(""), 10_000);
    },
    onError: (err: any) => setShipResult(`Backfill failed: ${err.message}`),
  });

  const reconcile = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/draft-tasks/reconcile-from-github", {});
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "reconcile failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      if ((data.added ?? 0) + (data.updated ?? 0) > 0) {
        setShipResult(`Pulled from GitHub: ${data.added ?? 0} new, ${data.updated ?? 0} updated`);
        setTimeout(() => setShipResult(""), 5000);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] });
    },
    onError: (err: any) => setShipResult(`GH reconcile failed: ${err.message}`),
  });

  // Auto-pull from GitHub on mount (silent if no PAT)
  useEffect(() => {
    if (cfg?.has_github_token) reconcile.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.has_github_token]);

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const r = await apiRequest("PATCH", `/api/draft-tasks/${id}`, { status });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] }),
  });

  const proposedCount = drafts.filter((d) => d.status === "proposed").length;
  const shippedCount = drafts.filter((d) => d.status === "shipped").length;

  return (
    <Layout
      title="Agent-Proposed Backlog"
      subtitle="Tasks drafted by the explorer agent in CC's 8-H2 schema. Accept → one-click ship to Command Center → fleet dispatches."
      actions={
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selected.size > 0 && (
            <>
              <button
                onClick={() => syncGh.mutate({ ids: Array.from(selected), merge: false })}
                disabled={syncGh.isPending}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent disabled:opacity-50"
              >
                <Github className="h-3.5 w-3.5" /> {syncGh.isPending ? "Syncing…" : `Sync ${selected.size} to GitHub`}
              </button>
              <button
                onClick={() => syncGh.mutate({ ids: Array.from(selected), merge: true })}
                disabled={syncGh.isPending}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent disabled:opacity-50"
                title="Group same-area tasks into one merged GitHub issue per cluster"
              >
                <Layers className="h-3.5 w-3.5" /> Sync + Merge
              </button>
              <button
                onClick={() => ship.mutate(Array.from(selected))}
                disabled={ship.isPending}
                className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Rocket className="h-3.5 w-3.5" /> {ship.isPending ? "Shipping…" : `Ship ${selected.size} to CC`}
              </button>
            </>
          )}
          {selected.size === 0 && (
            <button
              onClick={() => reconcile.mutate()}
              disabled={reconcile.isPending}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent disabled:opacity-50"
              title="Pull all autonomy-hub-labeled issues from both repos into this Backlog"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", reconcile.isPending && "animate-spin")} /> {reconcile.isPending ? "Pulling…" : "Pull from GitHub"}
            </button>
          )}
          {selected.size === 0 && (
            <button
              onClick={() => syncAll.mutate()}
              disabled={syncAll.isPending}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent disabled:opacity-50"
              title="One-click backfill: sync all un-synced drafts as merged GitHub issues"
            >
              <Github className="h-3.5 w-3.5" /> {syncAll.isPending ? "Migrating…" : "Migrate all to GitHub"}
            </button>
          )}
        </div>
      }
    >
      {shipResult && (
        <div className={cn("rounded-lg border p-3 mb-4 text-sm", shipResult.includes("failed") ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400")}>
          {shipResult}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Stat label="Proposed" value={proposedCount} tone="warn" />
        <Stat label="Accepted" value={drafts.filter((d) => d.status === "accepted").length} />
        <Stat label="Shipped" value={shippedCount} tone="good" sub={`to ${cfg?.cc_api_url.replace("https://", "").split(".")[0]}`} />
        <Stat label="Dismissed" value={drafts.filter((d) => d.status === "dismissed").length} />
      </div>

      <div className="flex items-center gap-1 mb-4 border border-input rounded-md overflow-x-auto text-xs max-w-full">
        {(["all", "proposed", "accepted", "shipped", "superseded", "dismissed"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("px-3 py-1.5 transition-colors whitespace-nowrap shrink-0", filter === f ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
            {f === "all" ? "All" : f} ({drafts.filter((d) => f === "all" || d.status === f).length})
          </button>
        ))}
      </div>

      {batches.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-10 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm font-medium">No {filter === "all" ? "" : filter + " "}drafts yet</div>
          <p className="text-xs text-muted-foreground mt-1">
            Drafts appear after the explorer agent completes a run. Trigger one from the Explorer page, or wait for the {cfg?.interval_minutes ?? 30}-minute cron.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {batches.map(([batchId, items]) => (
            <BatchCard
              key={batchId}
              batchId={batchId}
              items={items}
              selected={selected}
              setSelected={setSelected}
              onUpdate={(id, status) => updateStatus.mutate({ id, status })}
              onShip={(ids) => ship.mutate(ids)}
              shipping={ship.isPending}
            />
          ))}
        </div>
      )}
    </Layout>
  );
}

function BatchCard({ batchId, items, selected, setSelected, onUpdate, onShip, shipping }: {
  batchId: string; items: DraftTask[];
  selected: Set<number>; setSelected: (s: Set<number>) => void;
  onUpdate: (id: number, status: string) => void;
  onShip: (ids: number[]) => void;
  shipping: boolean;
}) {
  const unshipped = items.filter((i) => i.status === "proposed" || i.status === "accepted");
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const selectAllInBatch = () => {
    const next = new Set(selected);
    unshipped.forEach((i) => next.add(i.id));
    setSelected(next);
  };
  const shipBatch = () => onShip(unshipped.map((i) => i.id));

  return (
    <section className="rounded-lg border border-card-border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-card-border bg-muted/20">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Batch</div>
          <div className="font-mono text-xs truncate">{batchId}</div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground">{items.length} task{items.length === 1 ? "" : "s"}</span>
          {unshipped.length > 0 && (
            <>
              <button onClick={selectAllInBatch} className="text-xs px-2 py-1 rounded-md border border-card-border hover:bg-accent">Select all</button>
              <button onClick={shipBatch} disabled={shipping} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
                <Rocket className="h-3 w-3" /> Ship batch
              </button>
            </>
          )}
        </div>
      </header>
      <div className="divide-y divide-card-border">
        {items.map((t) => <TaskRow key={t.id} t={t} selected={selected.has(t.id)} toggle={() => toggle(t.id)} onUpdate={onUpdate} />)}
      </div>
    </section>
  );
}

function TaskRow({ t, selected, toggle, onUpdate }: { t: DraftTask; selected: boolean; toggle: () => void; onUpdate: (id: number, status: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const skills = JSON.parse(t.relevant_skills_json || "[]") as string[];
  const canSelect = t.status === "proposed" || t.status === "accepted";

  const copyBriefing = () => {
    navigator.clipboard.writeText(t.agent_briefing);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div className="flex items-start gap-3 px-4 py-3">
        <input type="checkbox" disabled={!canSelect} checked={selected} onChange={toggle} className="mt-1 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={cn("text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border", PRIORITY_BADGE[t.priority])}>{t.priority}</span>
            <span className={cn("text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded", STATUS_BADGE[t.status])}>{t.status}</span>
            <span className="text-[10px] font-mono text-muted-foreground">→ {t.project_slug}</span>
            <span className="text-[10px] text-muted-foreground">· {t.effort_estimate}</span>
          </div>
          <button onClick={() => setOpen(!open)} className="text-sm font-medium mt-1 text-left hover:text-primary">{t.title}</button>
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {skills.map((s) => <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono">{s}</span>)}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {t.gh_issue_number && t.gh_issue_url && (
            <a href={t.gh_issue_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded border border-card-border hover:bg-accent">
              <Github className="h-3 w-3" /> #{t.gh_issue_number}
            </a>
          )}
          {t.status === "shipped" && t.cc_task_id && (
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">CC #{t.cc_task_id}</span>
          )}
          {t.area && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{t.area}</span>
          )}
          {t.status === "proposed" && (
            <button onClick={() => onUpdate(t.id, "dismissed")} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-rose-600 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          {t.status === "dismissed" && (
            <button onClick={() => onUpdate(t.id, "proposed")} className="p-1.5 rounded-md hover:bg-accent text-muted-foreground" title="Restore">
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="bg-muted/20 border-t border-card-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Agent briefing (8-H2)</span>
            <button onClick={copyBriefing} className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-card-border hover:bg-accent">
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto rounded-md bg-background border border-card-border p-3">{t.agent_briefing}</pre>
          <div className="mt-2 flex items-center gap-2">
            <a href={t.repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><ExternalLink className="h-3 w-3" /> {t.repo_url.replace("https://github.com/", "")}</a>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "good" | "warn" }) {
  const ring = tone === "good" ? "border-emerald-500/40" : tone === "warn" ? "border-amber-500/40" : "border-card-border";
  return (
    <div className={cn("rounded-lg border bg-card p-4", ring)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
