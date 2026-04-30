import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Send, Cpu, ExternalLink, GitPullRequest, AlertCircle, Loader2, Github, RefreshCw, Zap } from "lucide-react";
import { Link } from "wouter";

type FleetRun = {
  id: number;
  kind: "executor_cron" | "ad_hoc";
  started_at: string;
  finished_at: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  trigger: string;
  executor: string;
  fallback_executor: string | null;
  model: string;
  priority: string;
  repo_url: string;
  cc_task_id: number | null;
  cc_task_status: string | null;
  gh_issue_numbers_json: string;
  gh_pr_url: string | null;
  gh_pr_state: string | null;
  user_prompt: string | null;
  agent_briefing: string;
  summary: string;
  error: string | null;
  duration_ms: number;
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 animate-pulse",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  cancelled: "bg-muted text-muted-foreground line-through",
};

const PRIORITY_COLORS: Record<string, string> = {
  p0: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
  p1: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  p2: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  p3: "bg-muted text-muted-foreground",
};

export default function Run() {
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [repo, setRepo] = useState<"backend" | "frontend" | "hub">("backend");
  const [executor, setExecutor] = useState<"pin-codex" | "pin-claude" | "unassigned" | "pin-codex-direct" | "pin-claude-direct">("pin-codex-direct");
  const [priority, setPriority] = useState<"p0" | "p1" | "p2" | "p3">("p0");
  const [statusMsg, setStatusMsg] = useState<string>("");

  const { data: runs = [], refetch } = useQuery<FleetRun[]>({
    queryKey: ["/api/fleet/runs"],
    refetchInterval: 5000,
  });

  const dispatch = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/run/dispatch", {
        user_prompt: prompt,
        repo,
        executor,
        priority,
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "dispatch failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      const where = data.direct ? `${data.agentId} (direct, pid ${data.pid})` : `CC task ${data.cc_task_id}`;
      setStatusMsg(`Dispatched run #${data.run.id} on ${data.model_pin} → ${where}`);
      setPrompt("");
      queryClient.invalidateQueries({ queryKey: ["/api/fleet/runs"] });
      setTimeout(() => setStatusMsg(""), 8000);
    },
    onError: (err: any) => setStatusMsg(`Dispatch failed: ${err.message}`),
  });

  const cancel = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/fleet/runs/${id}/cancel`, {});
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/fleet/runs"] }),
  });

  const adHocRuns = runs.filter((r) => r.kind === "ad_hoc");

  return (
    <Layout
      title="Run on Fleet"
      subtitle="Dispatch ad-hoc tasks to the local Mac Mini fleet. p0 = jumps the queue and runs concurrent even if lanes are busy. Each run gets full repo context + skills auto-injected."
      actions={
        <button
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      }
    >
      {statusMsg && (
        <div className={cn("rounded-lg border p-3 mb-4 text-sm", statusMsg.includes("failed") ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400" : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400")}>
          {statusMsg}
        </div>
      )}

      <section className="rounded-lg border border-primary/40 bg-primary/5 p-5 mb-6">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Send className="h-4 w-4" /> Dispatch a new fleet run</h3>
        <div className="space-y-3">
          <label className="block text-xs">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Prompt for the agent</div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. 'Add a new endpoint /api/foo to the backend that returns the last 10 explorer runs as JSON. Include a unit test.'"
              rows={5}
              className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm font-mono"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              Full repo context (recent merged PRs, open autonomy-hub issues), the relevant skills (codex-fleet, momentiq-shop-insights-dashboard-v2, sid-autonomy-actions-catalog), and the 8-H2 briefing template are auto-injected on top of your prompt.
            </div>
          </label>
          <div className="grid md:grid-cols-3 gap-3">
            <Field label="Target repo">
              <select value={repo} onChange={(e) => setRepo(e.target.value as any)} className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm">
                <option value="backend">backend (momentiq-shopinsights-backend)</option>
                <option value="frontend">frontend (momentiq-shopinsights-frontend)</option>
                <option value="hub">hub (autonomy-hub — self-improvement)</option>
              </select>
            </Field>
            <Field label="Executor (pinned model)">
              <select value={executor} onChange={(e) => setExecutor(e.target.value as any)} className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm">
                <optgroup label="Direct (mini-5, concurrent to CC)">
                  <option value="pin-codex-direct">pin-codex-direct · gpt_5_5 · mini-5</option>
                  <option value="pin-claude-direct">pin-claude-direct · claude_opus_4_7 · mini-5</option>
                </optgroup>
                <optgroup label="CC queue (FIFO, may wait)">
                  <option value="pin-codex">pin-codex · gpt_5_5</option>
                  <option value="pin-claude">pin-claude · claude_opus_4_7 thinking</option>
                  <option value="unassigned">unassigned · CC routes</option>
                </optgroup>
              </select>
            </Field>
            <Field label="Priority">
              <select value={priority} onChange={(e) => setPriority(e.target.value as any)} className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm">
                <option value="p0">p0 · jump queue, concurrent</option>
                <option value="p1">p1 · normal</option>
                <option value="p2">p2 · low</option>
                <option value="p3">p3 · backlog</option>
              </select>
            </Field>
          </div>
          <button
            onClick={() => dispatch.mutate()}
            disabled={dispatch.isPending || prompt.trim().length < 5}
            className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {dispatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {dispatch.isPending ? "Dispatching…" : "Dispatch to fleet"}
          </button>
        </div>
      </section>

      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Cpu className="h-4 w-4" /> Recent ad-hoc runs ({adHocRuns.length})</h3>

      {adHocRuns.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-10 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm font-medium">No ad-hoc runs yet</div>
          <p className="text-xs text-muted-foreground mt-1">Dispatch a task above; it'll appear here with live status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {adHocRuns.map((r) => <RunRow key={r.id} run={r} onCancel={() => cancel.mutate(r.id)} />)}
        </div>
      )}
    </Layout>
  );
}

function RunRow({ run, onCancel }: { run: FleetRun; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const elapsed = run.duration_ms ? `${Math.round(run.duration_ms / 1000)}s` : (run.finished_at ? "—" : `${Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000)}s`);
  const repoName = run.repo_url.replace("https://github.com/", "");
  const isDirect = run.executor === "pin-codex-direct" || run.executor === "pin-claude-direct";
  const ageSec = !run.finished_at ? Math.round((Date.now() - new Date(run.started_at).getTime()) / 1000) : 0;
  const isZombie = run.status === "running" && ageSec > 1200;

  return (
    <section className="rounded-lg border border-card-border bg-card overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-card-border bg-muted/20 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1 flex-wrap">
          <span className={cn("text-[10px] uppercase font-semibold tracking-wide px-2 py-0.5 rounded border", STATUS_COLORS[run.status])}>
            {run.status}
          </span>
          <span className={cn("text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded", PRIORITY_COLORS[run.priority])}>
            {run.priority}
          </span>
          {isDirect && (
            <span title="Direct tunnel — spawned on mini-5 outside CC's FIFO queue" className="text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400 inline-flex items-center gap-1">
              <Zap className="h-3 w-3" /> direct
            </span>
          )}
          {isZombie && (
            <span title="Running for >20 min — almost certainly stale. Use Fleet Runs > Reap zombies to finalize." className="text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-400">
              stale
            </span>
          )}
          <span className="text-[10px] font-mono text-muted-foreground">{run.executor} · {run.model}</span>
          <span className="text-[10px] text-muted-foreground truncate">{repoName} · {elapsed}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {run.gh_pr_url && (
            <a href={run.gh_pr_url} target="_blank" rel="noreferrer" className={cn(
              "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border",
              run.gh_pr_state === "merged" ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" : "border-amber-500/40 text-amber-700 dark:text-amber-400",
            )}>
              <GitPullRequest className="h-3 w-3" /> {run.gh_pr_state || "open"}
            </a>
          )}
          {run.cc_task_id && (
            <span className="text-[10px] font-mono text-muted-foreground">CC #{run.cc_task_id}</span>
          )}
          {(run.status === "queued" || run.status === "running") && (
            <button onClick={onCancel} className="text-[10px] px-2 py-1 rounded-md border border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10">Cancel</button>
          )}
          <button onClick={() => setOpen(!open)} className="text-[10px] px-2 py-1 rounded-md border border-card-border hover:bg-accent">{open ? "Hide" : "Details"}</button>
        </div>
      </header>
      {run.user_prompt && (
        <div className="px-4 py-2 text-xs">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">prompt: </span>
          <span className="font-mono text-foreground">{run.user_prompt.slice(0, 200)}{run.user_prompt.length > 200 ? "…" : ""}</span>
        </div>
      )}
      {run.summary && (
        <div className="px-4 py-2 text-xs border-t border-card-border bg-emerald-500/5">
          <span className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-400">summary: </span>
          <span className="text-foreground">{run.summary}</span>
        </div>
      )}
      {run.error && (
        <div className="px-4 py-2 text-xs border-t border-card-border bg-rose-500/5">
          <span className="text-[10px] uppercase tracking-wide text-rose-700 dark:text-rose-400">error: </span>
          <span className="text-foreground font-mono">{run.error}</span>
        </div>
      )}
      {open && (
        <div className="border-t border-card-border bg-muted/20 p-4 space-y-3">
          {(run.executor === "pin-codex-direct" || run.executor === "pin-claude-direct") && (
            <LiveTail runId={run.id} status={run.status} />
          )}
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Agent briefing (8-H2 with full context)</div>
            <pre className="text-xs font-mono whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto rounded-md bg-background border border-card-border p-3">{run.agent_briefing}</pre>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <a href={run.repo_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><Github className="h-3 w-3" /> {repoName}</a>
            {run.cc_task_id && (
              <a href={`https://command-center-api-production-96e2.up.railway.app/api/tasks/${run.cc_task_id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                <ExternalLink className="h-3 w-3" /> CC task
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function LiveTail({ runId, status }: { runId: number; status: string }) {
  const isLive = status === "running" || status === "queued";
  const { data, isFetching } = useQuery<{ ok: boolean; alive?: boolean; exited?: boolean; stdout_tail?: string; stderr_tail?: string; agentId?: string; workdir?: string; message?: string }>({
    queryKey: [`/api/fleet/runs/${runId}/poll`],
    refetchInterval: isLive ? 4000 : false,
  });
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Live tail (mini-5 direct)</div>
        {isFetching && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        {data?.alive && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">alive</span>}
        {data?.exited && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">exited</span>}
        {data?.agentId && <span className="text-[10px] font-mono text-muted-foreground">{data.agentId} · {data.workdir}</span>}
      </div>
      {data?.message && <div className="text-[11px] italic text-muted-foreground mb-1">{data.message}</div>}
      <div className="grid md:grid-cols-2 gap-2">
        <div>
          <div className="text-[9px] uppercase text-muted-foreground mb-0.5">stdout</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap leading-snug max-h-64 overflow-auto rounded-md bg-background border border-card-border p-2">{data?.stdout_tail || "(empty)"}</pre>
        </div>
        <div>
          <div className="text-[9px] uppercase text-muted-foreground mb-0.5">stderr</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap leading-snug max-h-64 overflow-auto rounded-md bg-background border border-card-border p-2">{data?.stderr_tail || "(empty)"}</pre>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs block">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}
