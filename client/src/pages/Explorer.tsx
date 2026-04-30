import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import type { ExplorerRun, ExplorerFinding, LedgerEntry, ExplorerStats, ExplorerHealth, CronConfig } from "@/lib/types";
import { useState } from "react";
import { Brain, Flame, Sparkles, Play, Settings, AlertCircle, CheckCircle2, XCircle, Clock, Pause, Zap, Rocket, ChevronDown, Github, KeyRound, Hash, Layers, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient as qc } from "@/lib/queryClient";
import { toast } from "@/hooks/use-toast";

const SEVERITY_BADGE = {
  low: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  high: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  critical: "bg-rose-600/30 text-rose-800 dark:text-rose-300 border-rose-600/50",
};

const STATUS_ICON = {
  queued: Clock,
  running: Sparkles,
  completed: CheckCircle2,
  failed: XCircle,
};

const STATUS_TONE = {
  queued: "text-muted-foreground",
  running: "text-amber-600 dark:text-amber-400",
  completed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-rose-600 dark:text-rose-400",
};

export default function Explorer() {
  const queryClient = useQueryClient();
  const { data: runs = [] } = useQuery<ExplorerRun[]>({ queryKey: ["/api/explorer/runs"], refetchInterval: 5000 });
  const { data: findings = [] } = useQuery<ExplorerFinding[]>({ queryKey: ["/api/findings"] });
  const { data: ledger = [] } = useQuery<LedgerEntry[]>({ queryKey: ["/api/ledger"] });
  const { data: stats } = useQuery<ExplorerStats>({ queryKey: ["/api/explorer/stats"], refetchInterval: 5000 });
  const { data: statsV2 } = useQuery<{
    runs: { total: number; completed: number; failed: number; last7d: number };
    drafts: { total: number; gh_issues_filed: number; shipped: number; last7d: number };
    findings: { total: number; open: number; critical_open: number; high_open: number; last7d: number };
    groupings: { areas: number; categories: number; phases: number; trackers: number };
    learning: { ledger_total: number; hot_patterns: number; total_observations: number; avg_heat: number };
  }>({ queryKey: ["/api/explorer/stats/v2"], refetchInterval: 5000 });
  const { data: health } = useQuery<ExplorerHealth>({ queryKey: ["/api/explorer/health"], refetchInterval: 5000 });
  const { data: cfg } = useQuery<CronConfig>({ queryKey: ["/api/cron-config"] });
  const [showSettings, setShowSettings] = useState(false);

  const triggerRun = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/explorer/trigger", { trigger: "manual" });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/health"] });
    },
  });

  const [fleetDispatchResult, setFleetDispatchResult] = useState<string>("");
  const [fleetExecutor, setFleetExecutor] = useState<string>("unassigned");
  const dispatchFleet = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/explorer/dispatch-fleet", { trigger: "manual_fleet", executor: fleetExecutor, priority: "p1" });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.error || "fleet dispatch failed");
      }
      return r.json();
    },
    onSuccess: (data) => {
      setFleetDispatchResult(`Dispatched to CC as task #${data.cc_task_id ?? "?"} — auto-dispatcher assigns within ~90s`);
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/stats"] });
      setTimeout(() => setFleetDispatchResult(""), 10_000);
    },
    onError: (err: any) => setFleetDispatchResult(`Dispatch failed: ${err.message}`),
  });

  const toggleCron = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await apiRequest("PATCH", "/api/cron-config", { enabled });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-config"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/health"] });
    },
  });

  const lastCompleted = runs.find((r) => r.status === "completed");

  return (
    <Layout
      title="Self-Learning Explorer"
      subtitle="Opus 4.7 thinking, compounding memory, hourly cron. Finds gaps in the codebase, distills patterns, drafts tasks for the CC fleet."
      actions={
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center border border-input rounded-md overflow-hidden text-xs">
            <select value={fleetExecutor} onChange={(e) => setFleetExecutor(e.target.value)} className="bg-card px-2 py-1.5 text-xs border-r border-input focus:outline-none">
              <option value="unassigned">any lane</option>
              <option value="pin-claude">Claude lane</option>
              <option value="pin-codex">Codex lane</option>
            </select>
            <button
              onClick={() => dispatchFleet.mutate()}
              disabled={dispatchFleet.isPending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              title="Dispatch to the Mac Mini fleet via Command Center for immediate execution"
            >
              <Rocket className="h-3.5 w-3.5" /> {dispatchFleet.isPending ? "Dispatching…" : "Dispatch to Fleet"}
            </button>
          </div>
          <button
            onClick={() => triggerRun.mutate()}
            disabled={triggerRun.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors disabled:opacity-50"
            title="Create a queued run for the hourly cron to pick up (no fleet dispatch)"
          >
            <Play className="h-3.5 w-3.5" /> {triggerRun.isPending ? "Queuing…" : "Queue for Cron"}
          </button>
          <button
            onClick={() => setShowSettings((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent transition-colors"
          >
            <Settings className="h-3.5 w-3.5" /> Settings
          </button>
        </div>
      }
    >
      {/* Hero metrics for the explorer agent. Replaces the old generic-cron metrics
          with explorer-relevant counts: tasks added, GitHub issues filed, phases,
          groupings, and compounding-learning telemetry. */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mb-3">
        <Stat
          label="Tasks added"
          value={statsV2?.drafts.total ?? 0}
          sub={`${statsV2?.drafts.last7d ?? 0} in last 7d`}
          tone={statsV2?.drafts.total ? "good" : undefined}
        />
        <Stat
          label="GitHub issues filed"
          value={statsV2?.drafts.gh_issues_filed ?? 0}
          sub={`${statsV2?.drafts.shipped ?? 0} shipped to fleet · ${statsV2?.groupings.trackers ?? 0} trackers`}
          icon={<Hash className="h-4 w-4" />}
        />
        <Stat
          label="Phases tracked"
          value={statsV2?.groupings.phases ?? 0}
          sub={`across ${statsV2?.groupings.categories ?? 0} categories`}
        />
        <Stat
          label="Groupings (areas)"
          value={statsV2?.groupings.areas ?? 0}
          sub="e.g. evals, drift, money-path"
          icon={<Layers className="h-4 w-4" />}
        />
        <Stat
          label="Open findings"
          value={statsV2?.findings.open ?? 0}
          sub={`${statsV2?.findings.critical_open ?? 0} crit · ${statsV2?.findings.high_open ?? 0} high · ${statsV2?.findings.last7d ?? 0} new in 7d`}
          tone={statsV2?.findings.critical_open ? "warn" : (statsV2?.findings.open ?? 0) > 5 ? "warn" : "good"}
        />
        <Stat
          label="Compounding ledger"
          value={`${statsV2?.learning.ledger_total ?? 0} / ${cfg?.max_ledger_entries ?? 50}`}
          sub={`${statsV2?.learning.hot_patterns ?? 0} hot · μ heat ${(statsV2?.learning.avg_heat ?? 0).toFixed(2)}`}
          icon={<Flame className="h-4 w-4" />}
        />
      </div>
      {/* Operational row — cron + run velocity */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="Cron status" value={cfg?.enabled ? "Enabled" : "Paused"} sub={cfg ? `Every ${cfg.interval_minutes} min` : ""} icon={cfg?.enabled ? <Zap className="h-4 w-4" /> : <Pause className="h-4 w-4" />} tone={cfg?.enabled ? "good" : "warn"} />
        <Stat label="Total runs" value={statsV2?.runs.total ?? 0} sub={`${statsV2?.runs.completed ?? 0} ok · ${statsV2?.runs.failed ?? 0} failed · ${statsV2?.runs.last7d ?? 0} in 7d`} />
        <Stat label="Run velocity" value={`${statsV2?.runs.last7d ?? 0}/wk`} sub="runs started in last 7 days" />
        <Stat label="Next run" value={health?.next_due_at ? formatRelative(health.next_due_at) : "—"} sub={health?.overdue_minutes ? `Overdue ${health.overdue_minutes} min` : "On schedule"} tone={health?.overdue_minutes && health.overdue_minutes > 5 ? "warn" : "default"} />
      </div>

      {/* GitHub PAT status banner — always visible so the user knows the cron has what it needs to file issues */}
      {cfg && (
        <div className={cn(
          "rounded-lg border p-3 mb-4 text-sm flex items-center justify-between flex-wrap gap-3",
          cfg.has_github_token
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300"
            : "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-300",
        )}>
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 shrink-0" />
            {cfg.has_github_token ? (
              <span>
                <span className="font-medium">GitHub PAT saved</span>
                {cfg.github_token_last4 && (
                  <span className="ml-1 font-mono text-xs opacity-80">· ••••{cfg.github_token_last4}</span>
                )}
                {cfg.github_token_set_at && (
                  <span className="ml-1 opacity-70 text-xs">· set {formatRelative(cfg.github_token_set_at)}</span>
                )}
                <span className="ml-1 opacity-80 text-xs">· cron files issues to <span className="font-mono">{cfg.default_gh_repo}</span> + <span className="font-mono">{cfg.frontend_gh_repo}</span></span>
              </span>
            ) : (
              <span>
                <span className="font-medium">No GitHub PAT saved</span>
                <span className="ml-1 opacity-80 text-xs">· cron + sync can’t file issues until you add one in Settings</span>
              </span>
            )}
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="text-xs px-2.5 py-1 rounded-md border border-current/30 hover:bg-current/5"
          >
            {cfg.has_github_token ? "Update PAT" : "Add PAT"}
          </button>
        </div>
      )}

      {fleetDispatchResult && (
        <div className={cn("rounded-lg border p-3 mb-4 text-sm", fleetDispatchResult.includes("failed") ? "border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400" : "border-primary/30 bg-primary/5 text-primary") }>
          <Rocket className="h-4 w-4 inline mr-2" /> {fleetDispatchResult}
        </div>
      )}

      {showSettings && cfg && <SettingsPanel cfg={cfg} onSave={() => qc.invalidateQueries({ queryKey: ["/api/cron-config"] })} onToggle={(v) => toggleCron.mutate(v)} />}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Latest summary + gameplan */}
        <section className="lg:col-span-2 rounded-lg border border-card-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold flex items-center gap-2"><Brain className="h-4 w-4 text-muted-foreground" /> Last completed run</h2>
            {lastCompleted && <span className="text-xs text-muted-foreground">RUN #{lastCompleted.id} · {formatRelative(lastCompleted.finished_at!)}</span>}
          </div>
          {lastCompleted ? (
            <>
              <div className="rounded-md border border-card-border bg-muted/30 p-3">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Summary</div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{lastCompleted.summary}</p>
              </div>
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 mt-3">
                <div className="text-[10px] uppercase tracking-wide text-primary mb-1">Next-run gameplan</div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{lastCompleted.next_gameplan}</p>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center text-xs">
                <Mini label="Findings" value={lastCompleted.findings_count} />
                <Mini label="Ledger entries" value={lastCompleted.ledger_entries_count} />
                <Mini label="Drafts" value={lastCompleted.draft_tasks_count} />
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground italic">No completed runs yet. Hit "Run Now" or wait for the cron to fire.</div>
          )}
        </section>

        {/* Run history */}
        <section className="rounded-lg border border-card-border bg-card p-5">
          <h2 className="font-semibold flex items-center gap-2 mb-3"><Clock className="h-4 w-4 text-muted-foreground" /> Run history</h2>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No runs yet.</div>
          ) : (
            <ul className="divide-y divide-card-border">
              {runs.slice(0, 12).map((r) => (
                <ExplorerRunRow key={r.id} run={r} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Ledger */}
      <section className="mt-8">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><Flame className="h-4 w-4 text-amber-600" /> Learning ledger <span className="text-xs text-muted-foreground font-normal">heat-sorted, capped at {cfg?.max_ledger_entries ?? 50}</span></h2>
        {ledger.length === 0 ? (
          <div className="rounded-lg border border-card-border bg-card p-6 text-center text-sm text-muted-foreground italic">No ledger entries yet — patterns will accumulate as runs complete.</div>
        ) : (
          <div className="space-y-2">
            {ledger.map((l) => (
              <div key={l.id} className="rounded-lg border border-card-border bg-card p-3 flex items-start gap-3">
                <div className="shrink-0 w-12 text-center">
                  <div className="text-[10px] uppercase text-muted-foreground">heat</div>
                  <div className="font-semibold tabular-nums" style={{ color: heatColor(l.heat) }}>{l.heat.toFixed(1)}</div>
                  <div className="text-[10px] text-muted-foreground">×{l.seen_count}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{l.pattern}</div>
                  {l.context && <div className="text-xs text-muted-foreground mt-0.5">{l.context}</div>}
                  <div className="text-[10px] text-muted-foreground mt-1">last seen {formatRelative(l.last_seen_at)} · run #{l.source_run_id}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Findings */}
      <section className="mt-8">
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2"><AlertCircle className="h-4 w-4 text-muted-foreground" /> Findings</h2>
        {findings.length === 0 ? (
          <div className="rounded-lg border border-card-border bg-card p-6 text-center text-sm text-muted-foreground italic">No findings yet.</div>
        ) : (
          <div className="space-y-2">
            {findings.slice(0, 30).map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}

function ExplorerRunRow({ run }: { run: ExplorerRun }) {
  const queryClient = useQueryClient();
  const Icon = STATUS_ICON[run.status];

  const replay = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/explorer/runs/${run.id}/replay`, {});
      if (!r.ok) throw new Error((await r.json()).error || "replay failed");
      return r.json() as Promise<{ ok: boolean; run: ExplorerRun; parent_run_id: number }>;
    },
    onSuccess: (data) => {
      toast({ title: `Replay queued — new run #${data.run.id}`, description: `Re-dispatching explorer run #${data.parent_run_id} with the same settings.` });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/explorer/stats"] });
    },
    onError: (err: any) => toast({ title: "Replay failed", description: err.message, variant: "destructive" }),
  });

  return (
    <li className="py-2 flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1 flex items-center gap-2">
        <Icon className={cn("h-3.5 w-3.5 shrink-0", STATUS_TONE[run.status])} />
        <span className="font-mono text-xs text-muted-foreground tabular-nums shrink-0">#{run.id}</span>
        <span className="text-xs truncate">{run.trigger}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <div className="text-[10px] text-muted-foreground tabular-nums">{run.duration_ms ? `${(run.duration_ms / 1000).toFixed(0)}s` : ""} · {formatRelative(run.started_at)}</div>
        {(run.status === "failed" || (run.status as string) === "cancelled") && (
          <button
            onClick={() => replay.mutate()}
            disabled={replay.isPending}
            title="Re-dispatch this explorer run with the same settings"
            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-violet-500/40 text-violet-700 dark:text-violet-400 hover:bg-violet-500/10 disabled:opacity-50 transition-colors"
          >
            <RotateCw className={cn("h-3 w-3", replay.isPending && "animate-spin")} />
            {replay.isPending ? "Replaying…" : "Replay"}
          </button>
        )}
      </div>
    </li>
  );
}

function FindingRow({ f }: { f: ExplorerFinding }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const evidence = JSON.parse(f.evidence_json || "[]") as string[];
  const update = useMutation({
    mutationFn: async (status: string) => {
      const r = await apiRequest("PATCH", `/api/findings/${f.id}`, { status });
      return r.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/findings"] }),
  });
  return (
    <div className={cn("rounded-lg border bg-card", f.status === "dismissed" ? "border-card-border opacity-50" : "border-card-border")}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-start gap-3 p-3 text-left">
        <span className={cn("text-[10px] uppercase font-semibold tracking-wide px-1.5 py-0.5 rounded border shrink-0", SEVERITY_BADGE[f.severity])}>{f.severity}</span>
        <span className="text-[10px] uppercase text-muted-foreground shrink-0 mt-0.5">{f.category.replace("_", " ")}</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{f.title}</div>
          {f.action_name && <div className="text-[11px] font-mono text-muted-foreground mt-0.5">→ {f.action_name}</div>}
        </div>
        <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">RUN #{f.run_id}</span>
      </button>
      {open && (
        <div className="border-t border-card-border p-3 text-sm">
          <p className="whitespace-pre-wrap text-foreground/90">{f.body}</p>
          {evidence.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {evidence.map((e, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-muted font-mono">{e}</span>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button onClick={() => update.mutate("accepted")} className="text-xs px-2.5 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20">Accept</button>
            <button onClick={() => update.mutate("dismissed")} className="text-xs px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-card-border hover:bg-accent">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsPanel({ cfg, onSave, onToggle }: { cfg: CronConfig; onSave: () => void; onToggle: (v: boolean) => void }) {
  // Rename intentionally avoids shadowing the global setInterval.
  const [intervalMin, setIntervalMin] = useState(cfg.interval_minutes);
  const [model, setModel] = useState(cfg.model);
  const [maxLedger, setMaxLedger] = useState(cfg.max_ledger_entries);
  const [maxSummaries, setMaxSummaries] = useState(cfg.max_prior_summaries);
  const [ccUrl, setCcUrl] = useState(cfg.cc_api_url);
  const [defaultProject, setDefaultProject] = useState(cfg.default_cc_project_slug);
  const [autoGh, setAutoGh] = useState(!!cfg.auto_create_gh_issues);
  const [defaultRepo, setDefaultRepo] = useState(cfg.default_gh_repo);
  const [frontendRepo, setFrontendRepo] = useState(cfg.frontend_gh_repo);
  const [batchSame, setBatchSame] = useState(!!cfg.batch_same_area);
  const [batchMin, setBatchMin] = useState(cfg.batch_min_siblings);
  const [ghToken, setGhToken] = useState("");
  // Newer fields surfaced by the most recent backend revision.
  const [focusMission, setFocusMission] = useState(cfg.focus_mission ?? "");
  const [autonomousLoop, setAutonomousLoop] = useState((cfg as any).autonomous_indefinite_loop !== false);
  const [autoResumeExplorer, setAutoResumeExplorer] = useState(!!cfg.auto_resume_explorer);
  const [autoResumeExecutor, setAutoResumeExecutor] = useState(!!cfg.auto_resume_executor);
  const [autoResumeMax, setAutoResumeMax] = useState(cfg.auto_resume_max_concurrent ?? 3);
  const [autoResumeExplorerMax, setAutoResumeExplorerMax] = useState((cfg as any).auto_resume_explorer_max ?? 3);
  const [autoResumeExecutorMax, setAutoResumeExecutorMax] = useState((cfg as any).auto_resume_executor_max ?? 3);
  const [autoResumeGap, setAutoResumeGap] = useState(cfg.auto_resume_min_gap_sec ?? 30);
  const [mini5Fallback, setMini5Fallback] = useState(cfg.mini5_fallback_enabled !== false);
  const [airtableKey, setAirtableKey] = useState("");
  const [mondayKey, setMondayKey] = useState("");
  const [driveOauth, setDriveOauth] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("PATCH", "/api/cron-config", {
        interval_minutes: intervalMin,
        model,
        max_ledger_entries: maxLedger,
        max_prior_summaries: maxSummaries,
        cc_api_url: ccUrl,
        default_cc_project_slug: defaultProject,
        auto_create_gh_issues: autoGh,
        default_gh_repo: defaultRepo,
        frontend_gh_repo: frontendRepo,
        batch_same_area: batchSame,
        batch_min_siblings: batchMin,
        focus_mission: focusMission,
        autonomous_indefinite_loop: autonomousLoop,
        auto_resume_explorer: autoResumeExplorer,
        auto_resume_executor: autoResumeExecutor,
        auto_resume_max_concurrent: autoResumeMax,
        auto_resume_explorer_max: autoResumeExplorerMax,
        auto_resume_executor_max: autoResumeExecutorMax,
        auto_resume_min_gap_sec: autoResumeGap,
        mini5_fallback_enabled: mini5Fallback,
        ...(ghToken ? { github_token: ghToken } : {}),
        ...(airtableKey ? { airtable_api_key: airtableKey } : {}),
        ...(mondayKey ? { monday_api_key: mondayKey } : {}),
        ...(driveOauth ? { google_drive_oauth: driveOauth } : {}),
      });
      return r.json();
    },
    onSuccess: () => {
      // Clear write-only secrets so they don't get re-submitted on the next Save.
      setGhToken("");
      setAirtableKey("");
      setMondayKey("");
      setDriveOauth("");
      onSave();
    },
  });
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-5 mb-6">
      <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Settings className="h-4 w-4" /> Cron + agent settings</h3>

      {/* Focus mission — the steering prompt the explorer reads at the top of every run. */}
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
          Focus mission <span className="normal-case font-normal">· free-form steering prompt prepended to every explorer run · leave blank to use defaults</span>
        </div>
        <textarea
          value={focusMission}
          onChange={(e) => setFocusMission(e.target.value)}
          rows={6}
          placeholder="e.g. Bias HARD to money-path actions and training data starvation. Each run propose 5-8 findings and 4-8 draft tasks targeting the next-most-valuable cluster."
          className="w-full px-3 py-2 rounded-md border border-input bg-background text-xs font-mono leading-relaxed"
        />
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <Field label="Interval (min)" type="number" value={intervalMin} onChange={(v) => setIntervalMin(parseInt(v) || 30)} hint="5-1440" />
        <Field label="Model" value={model} onChange={setModel} hint="claude_opus_4_7 recommended" />
        <Field label="Default CC project" value={defaultProject} onChange={setDefaultProject} />
        <Field label="Max ledger entries" type="number" value={maxLedger} onChange={(v) => setMaxLedger(parseInt(v) || 50)} hint="10-200" />
        <Field label="Max prior summaries" type="number" value={maxSummaries} onChange={(v) => setMaxSummaries(parseInt(v) || 5)} hint="1-20" />
        <Field label="CC API URL" value={ccUrl} onChange={setCcUrl} />
        <Field label="Backend repo" value={defaultRepo} onChange={setDefaultRepo} hint="owner/name" />
        <Field label="Frontend repo" value={frontendRepo} onChange={setFrontendRepo} hint="owner/name" />
        <Field label="Batch min siblings" type="number" value={batchMin} onChange={(v) => setBatchMin(parseInt(v) || 2)} hint="merge groups ≥ N" />
        <Field
          label={cfg.has_github_token
            ? `GitHub PAT (saved ••••${cfg.github_token_last4 ?? ""})`
            : "GitHub PAT"}
          value={ghToken}
          onChange={setGhToken}
          type="password"
          hint={cfg.has_github_token
            ? `set ${cfg.github_token_set_at ? formatRelative(cfg.github_token_set_at) : "—"} · leave blank to keep`
            : "required for cron + sync"}
        />
      </div>

      {/* Always-running engine — how aggressively the Hub re-fires runs to keep the fleet hot. */}
      <div className="mt-5 rounded-md border border-card-border bg-background/40 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">Always-running engine</div>
        {/* Master loop toggle — when off all auto-resume halts */}
        <label className="text-xs flex items-start gap-2 cursor-pointer leading-snug mb-3">
          <input type="checkbox" checked={autonomousLoop} onChange={(e) => setAutonomousLoop(e.target.checked)} className="mt-0.5" />
          <span className={autonomousLoop ? "" : "line-through opacity-60"}>
            Master loop
            <br/>
            <span className="text-[10px] text-muted-foreground normal-case">
              {autonomousLoop ? "ON — auto-resume running" : "OFF — all auto-resume halted"}
            </span>
          </span>
        </label>
        <div className="grid md:grid-cols-4 gap-3">
          <label className="text-xs flex items-start gap-2 cursor-pointer leading-snug">
            <input type="checkbox" checked={autoResumeExplorer} onChange={(e) => setAutoResumeExplorer(e.target.checked)} className="mt-0.5" />
            <span>Auto-resume explorer<br/><span className="text-[10px] text-muted-foreground">re-fire when last run completes</span></span>
          </label>
          <label className="text-xs flex items-start gap-2 cursor-pointer leading-snug">
            <input type="checkbox" checked={autoResumeExecutor} onChange={(e) => setAutoResumeExecutor(e.target.checked)} className="mt-0.5" />
            <span>Auto-resume executor<br/><span className="text-[10px] text-muted-foreground">re-fire executor cron when idle</span></span>
          </label>
          <Field label="Explorer max" type="number" value={autoResumeExplorerMax} onChange={(v) => setAutoResumeExplorerMax(parseInt(v) || 3)} hint="1-10 explorer slots" />
          <Field label="Executor max" type="number" value={autoResumeExecutorMax} onChange={(v) => setAutoResumeExecutorMax(parseInt(v) || 3)} hint="1-10 executor slots" />
          <Field label="Min gap (sec)" type="number" value={autoResumeGap} onChange={(v) => setAutoResumeGap(parseInt(v) || 30)} hint="10-600 between fires" />
        </div>
        <label className="mt-3 text-xs flex items-start gap-2 cursor-pointer leading-snug">
          <input type="checkbox" checked={mini5Fallback} onChange={(e) => setMini5Fallback(e.target.checked)} className="mt-0.5" />
          <span>Mini-5 fallback enabled <span className="text-[10px] text-muted-foreground">· when CC queue stalls, retry via direct tunnel to mini-5</span></span>
        </label>
      </div>

      {/* External data source credentials — stored encrypted at rest, never returned over the wire. */}
      <div className="mt-5 rounded-md border border-card-border bg-background/40 p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">External data sources</div>
        <div className="grid md:grid-cols-3 gap-3">
          <Field
            label={cfg.has_airtable_key ? "Airtable API key (saved)" : "Airtable API key"}
            value={airtableKey}
            onChange={setAirtableKey}
            type="password"
            hint={cfg.has_airtable_key ? "leave blank to keep · enter new value to rotate" : "unlocks deal/sample tables"}
          />
          <Field
            label={cfg.has_monday_key ? "Monday API key (saved)" : "Monday API key"}
            value={mondayKey}
            onChange={setMondayKey}
            type="password"
            hint={cfg.has_monday_key ? "leave blank to keep" : "unlocks pipeline boards"}
          />
          <Field
            label={cfg.has_drive_oauth ? "Google Drive OAuth (saved)" : "Google Drive OAuth JSON"}
            value={driveOauth}
            onChange={setDriveOauth}
            type="password"
            hint={cfg.has_drive_oauth ? "leave blank to keep" : "paste refresh-token JSON"}
          />
        </div>
      </div>

      <div className="flex items-center gap-5 mt-4 text-xs flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={autoGh} onChange={(e) => setAutoGh(e.target.checked)} /> Auto-create GitHub issues (skip HITL)
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={batchSame} onChange={(e) => setBatchSame(e.target.checked)} /> Auto-batch same-area tasks
        </label>
      </div>
      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => onToggle(!cfg.enabled)} className={cn("text-xs px-3 py-1.5 rounded-md border", cfg.enabled ? "border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/10" : "border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10")}>
            {cfg.enabled ? "Pause cron" : "Enable cron"}
          </button>
          <span className="text-xs text-muted-foreground">Currently: <span className="font-medium">{cfg.enabled ? "running" : "paused"}</span></span>
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", hint }: { label: string; value: any; onChange: (v: string) => void; type?: string; hint?: string }) {
  return (
    <label className="text-xs">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{label}{hint && <span className="ml-1 normal-case font-normal">· {hint}</span>}</div>
      <input value={value} onChange={(e) => onChange(e.target.value)} type={type} className="w-full px-2 py-1.5 rounded-md border border-input bg-background text-sm" />
    </label>
  );
}

function Stat({ label, value, sub, icon, tone }: { label: string; value: string | number; sub?: string; icon?: React.ReactNode; tone?: "good" | "warn" | "default" }) {
  const ring = tone === "good" ? "border-emerald-500/40" : tone === "warn" ? "border-amber-500/40" : "border-card-border";
  return (
    <div className={cn("rounded-lg border bg-card p-4", ring)}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
        <span>{label}</span>
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = (d - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return diff > 0 ? "<1 min" : "just now";
  if (abs < 3600) return diff > 0 ? `in ${Math.round(abs / 60)} min` : `${Math.round(abs / 60)} min ago`;
  if (abs < 86400) return diff > 0 ? `in ${Math.round(abs / 3600)}h` : `${Math.round(abs / 3600)}h ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function heatColor(h: number): string {
  if (h >= 5) return "hsl(0 70% 50%)";
  if (h >= 3) return "hsl(20 80% 50%)";
  if (h >= 1.5) return "hsl(43 74% 49%)";
  return "hsl(var(--muted-foreground))";
}
