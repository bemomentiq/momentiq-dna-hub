import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Cpu, GitPullRequest, AlertCircle, RefreshCw, Play, Github, ExternalLink, Zap, Trash2, RotateCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useState } from "react";

type FleetRun = {
  id: number;
  kind: "executor_cron" | "ad_hoc";
  started_at: string;
  finished_at: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  trigger: string;
  executor: string;
  model: string;
  priority: string;
  repo_url: string;
  cc_task_id: number | null;
  gh_issue_numbers_json: string;
  gh_pr_url: string | null;
  gh_pr_state: string | null;
  user_prompt: string | null;
  agent_briefing: string;
  summary: string;
  error: string | null;
  duration_ms: number;
  parent_run_id?: number | null;
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground border-card-border",
  running: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 animate-pulse",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  cancelled: "bg-muted text-muted-foreground line-through border-card-border",
};

export default function Fleet() {
  const queryClient = useQueryClient();
  const [statusMsg, setStatusMsg] = useState("");
  const { data: allRuns = [], refetch } = useQuery<FleetRun[]>({
    queryKey: ["/api/fleet/runs"],
    refetchInterval: 8000,
  });

  const triggerExec = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/executor/dispatch", { trigger: "manual_button" });
      if (!r.ok) throw new Error((await r.json()).error || "dispatch failed");
      return r.json();
    },
    onSuccess: (data) => {
      setStatusMsg(`Executor run #${data.run_id} dispatched on ${data.model_pin} (CC #${data.cc_task_id})`);
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/runs"] });
      setTimeout(() => setStatusMsg(""), 6000);
    },
    onError: (err: any) => setStatusMsg(`Trigger failed: ${err.message}`),
  });

  // Reap zombies: ask the backend to scan running direct-tunnel runs, ask their
  // mini for the agent's exit state, and finalize anything that has actually exited.
  // This is what unsticks the dashboard when codex/claude on mini-5 has died but
  // its run row is still showing 'running' for hours.
  const reapZombies = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/fleet/reap-dead-direct-runs", {});
      if (!r.ok) throw new Error((await r.json()).error || "reap failed");
      return r.json() as Promise<{ scanned: number; reaped: number }>;
    },
    onSuccess: (data) => {
      setStatusMsg(`Reaper scanned ${data.scanned} direct runs, finalized ${data.reaped}.`);
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/runs"] });
      setTimeout(() => setStatusMsg(""), 6000);
    },
    onError: (err: any) => setStatusMsg(`Reap failed: ${err.message}`),
  });

  const executor = allRuns.filter((r) => r.kind === "executor_cron");
  const adHoc = allRuns.filter((r) => r.kind === "ad_hoc");
  const stats = {
    completed: allRuns.filter((r) => r.status === "completed").length,
    running: allRuns.filter((r) => r.status === "running").length,
    failed: allRuns.filter((r) => r.status === "failed").length,
    prsMerged: allRuns.filter((r) => r.gh_pr_state === "merged").length,
    prsOpen: allRuns.filter((r) => r.gh_pr_state === "open").length,
  };

  return (
    <Layout
      title="Fleet Runs"
      subtitle="Live view of every executor cron + ad-hoc run dispatched to the Mac Mini fleet. Each run plans → executes → opens PR → babysits CI to merge."
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => triggerExec.mutate()}
            disabled={triggerExec.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5" /> {triggerExec.isPending ? "Dispatching…" : "Trigger executor now"}
          </button>
          <button
            onClick={() => reapZombies.mutate()}
            disabled={reapZombies.isPending}
            title="Scan running direct-tunnel runs and finalize ones whose agent has exited on mini-5"
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" /> {reapZombies.isPending ? "Reaping…" : "Reap zombies"}
          </button>
          <button onClick={() => refetch()} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      }
    >
      {statusMsg && (
        <div className={cn("rounded-lg border p-3 mb-4 text-sm", statusMsg.includes("failed") ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400")}>
          {statusMsg}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="Total runs" value={allRuns.length} />
        <Stat label="Running" value={stats.running} tone={stats.running > 0 ? "warn" : undefined} />
        <Stat label="Completed" value={stats.completed} tone="good" />
        <Stat label="PRs merged" value={stats.prsMerged} tone="good" sub="auto-merge wins" />
        <Stat label="Failed" value={stats.failed} tone={stats.failed > 0 ? "bad" : undefined} />
      </div>

      <Section title="Executor cron runs" subtitle="Runs created by the hourly executor cron — each picks up one open autonomy-hub issue, ships a PR, babysits CI." runs={executor} />
      <div className="mt-8" />
      <Section title="Ad-hoc runs" subtitle="Runs created from the Run-on-Fleet UI — user-supplied prompts dispatched immediately at p0." runs={adHoc} />
    </Layout>
  );
}

function Section({ title, subtitle, runs }: { title: string; subtitle: string; runs: FleetRun[] }) {
  return (
    <section>
      <h3 className="font-semibold text-sm flex items-center gap-2 mb-1"><Cpu className="h-4 w-4" /> {title} <span className="text-xs text-muted-foreground font-normal">({runs.length})</span></h3>
      <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>
      {runs.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-6 text-center">
          <AlertCircle className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
          <div className="text-xs text-muted-foreground">No runs yet</div>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.slice(0, 30).map((r) => <RunRow key={r.id} run={r} />)}
        </div>
      )}
    </section>
  );
}

function RunRow({ run }: { run: FleetRun }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const elapsed = run.duration_ms ? `${Math.round(run.duration_ms / 1000)}s` : (!run.finished_at ? `${Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000)}s` : "—");
  const repoName = run.repo_url.replace("https://github.com/", "");

  const replay = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/fleet/runs/${run.id}/replay`, {});
      if (!r.ok) throw new Error((await r.json()).error || "replay failed");
      return r.json() as Promise<{ ok: boolean; run: FleetRun; cc_task_id?: number; parent_run_id: number }>;
    },
    onSuccess: (data) => {
      toast({ title: `Replay queued — new run #${data.run.id}`, description: `Re-dispatching run #${data.parent_run_id} with the same briefing.` });
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/runs"] });
    },
    onError: (err: any) => toast({ title: "Replay failed", description: err.message, variant: "destructive" }),
  });
  const issues: number[] = (() => { try { return JSON.parse(run.gh_issue_numbers_json || "[]"); } catch { return []; } })();
  // Direct-tunnel runs bypass the CC FIFO queue and run concurrently on mini-5.
  // Surface this on the row so it's obvious which path a run took.
  const isDirect = run.executor === "pin-codex-direct" || run.executor === "pin-claude-direct";
  // Long-running runs (>20 min still 'running') are almost certainly zombies.
  const ageSec = !run.finished_at ? Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000) : 0;
  const isZombie = run.status === "running" && ageSec > 1200;

  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-accent/30 cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-[10px] font-mono text-muted-foreground">#{run.id}</span>
          <span className={cn("text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border", STATUS_COLORS[run.status])}>{run.status}</span>
          {isDirect && (
            <span title="Direct tunnel — ran on mini-5 outside CC's FIFO queue" className="text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400 inline-flex items-center gap-1">
              <Zap className="h-3 w-3" /> direct
            </span>
          )}
          {isZombie && (
            <span title="Running for >20 min — almost certainly stale. Hit 'Reap zombies' to finalize." className="text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400">
              stale
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">{run.executor} · {run.model}</span>
          <span className="text-xs text-foreground truncate flex-1 min-w-0">
            {run.kind === "ad_hoc" && run.user_prompt ? run.user_prompt.slice(0, 100) : run.summary || (run.kind === "executor_cron" ? `Executor: ${repoName}${issues.length ? ` · issues #${issues.join(", #")}` : ""}` : "—")}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-muted-foreground">{elapsed}</span>
          {run.gh_pr_url && (
            <a href={run.gh_pr_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border", run.gh_pr_state === "merged" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400")}>
              <GitPullRequest className="h-3 w-3" /> {run.gh_pr_state || "open"}
            </a>
          )}
          {(run.status === "failed" || run.status === "cancelled") && (
            <button
              onClick={(e) => { e.stopPropagation(); replay.mutate(); }}
              disabled={replay.isPending}
              title="Re-dispatch this run with the same briefing"
              className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/10 disabled:opacity-50 transition-colors"
            >
              <RotateCw className={cn("h-3 w-3", replay.isPending && "animate-spin")} />
              {replay.isPending ? "Replaying…" : "Replay"}
            </button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-card-border bg-muted/20 p-3 text-xs space-y-2">
          {run.user_prompt && <div><span className="text-[10px] uppercase tracking-wide text-muted-foreground">user prompt: </span><span className="font-mono">{run.user_prompt}</span></div>}
          {run.summary && <div><span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">summary: </span>{run.summary}</div>}
          {run.error && <div><span className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-400">error: </span><span className="font-mono">{run.error}</span></div>}
          <div className="flex items-center gap-3 text-[11px]">
            <a href={run.repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Github className="h-3 w-3" /> {repoName}</a>
            {run.cc_task_id && <span className="font-mono text-muted-foreground">CC #{run.cc_task_id}</span>}
          </div>
          <details>
            <summary className="text-[10px] uppercase tracking-wide text-muted-foreground cursor-pointer hover:text-foreground">briefing</summary>
            <pre className="mt-2 text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-auto rounded-md bg-background border border-card-border p-2">{run.agent_briefing}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "border-emerald-500/40" : tone === "warn" ? "border-amber-500/40" : tone === "bad" ? "border-rose-500/40" : "border-card-border";
  return (
    <div className={cn("rounded-lg border bg-card p-4", ring)}>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
