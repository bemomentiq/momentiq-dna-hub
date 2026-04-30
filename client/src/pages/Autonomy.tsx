import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { cn } from "@/lib/utils";
import {
  Brain,
  Cpu,
  GitMerge,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  ExternalLink,
  Bug,
  GitPullRequest,
  Activity,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

type AutonomyStatus = {
  in_flight: { explorer: number; executor: number; ad_hoc: number };
  auto_resume: {
    explorer: boolean;
    executor: boolean;
    autonomous_indefinite_loop: boolean;
    explorer_max: number;
    executor_max: number;
  };
  test_debug: {
    enabled: boolean;
    interval_hours: number;
    last_run_at: string | null;
    last_status: string | null;
    last_findings_count: number | null;
  };
  pr_babysitter: {
    enabled: boolean;
    last_run_at: string | null;
    last_status: string | null;
    last_pr_number: number | null;
  };
  ts: string;
};

type CompanionSignals = {
  readiness: { category: string; completion_pct: number; blocked_items: string[] }[] | null;
  roadmapState: {
    current_phase: string;
    phases: { id: string; title: string; status: string; progress_pct: number }[];
    next_milestone: string;
  } | null;
};

type TimelineEntry = {
  id: string;
  kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number;
  lane: string;
  label: string;
  error: string | null;
};

type QueueEntry = {
  id: number;
  title: string;
  area: string | null;
  priority: string;
  ev_score: number;
  status: string;
};

type MergedPr = {
  number: number;
  title: string;
  repo: string;
  merged_at: string;
  html_url: string;
  author: string | null;
  labels: string[];
};

type GhIssuesResponse = {
  issues: { number: number; state: string; repo: string }[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelative(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = (d - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return diff > 0 ? "<1 min" : "just now";
  if (abs < 3600) return diff > 0 ? `in ${Math.round(abs / 60)} min` : `${Math.round(abs / 60)}m ago`;
  if (abs < 86400) return diff > 0 ? `in ${Math.round(abs / 3600)}h` : `${Math.round(abs / 3600)}h ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function durationLabel(ms: number): string {
  if (!ms) return "";
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

/** Build 24 buckets of 15-min windows for the last 6 hours from the timeline list. */
function buildChartData(timeline: TimelineEntry[]) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const buckets: { time: string; Explorer: number; Executor: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const bucketStart = now - (i + 1) * windowMs;
    const bucketEnd = now - i * windowMs;
    const label = new Date(bucketEnd).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    let explorer = 0;
    let executor = 0;
    for (const r of timeline) {
      const start = new Date(r.started_at).getTime();
      const end = r.finished_at ? new Date(r.finished_at).getTime() : now;
      // count run as in-flight during this bucket if it overlaps
      if (start < bucketEnd && end > bucketStart) {
        if (r.kind === "explorer") explorer++;
        else executor++;
      }
    }
    buckets.push({ time: label, Explorer: explorer, Executor: executor });
  }
  return buckets;
}

const STATUS_ICON: Record<string, React.ElementType> = {
  queued: Clock,
  running: Sparkles,
  completed: CheckCircle2,
  failed: XCircle,
  cancelled: XCircle,
};

const STATUS_TONE: Record<string, string> = {
  queued: "text-muted-foreground",
  running: "text-amber-600 dark:text-amber-400",
  completed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-rose-600 dark:text-rose-400",
  cancelled: "text-rose-500 dark:text-rose-400",
};

const PRIORITY_BADGE: Record<string, string> = {
  p0: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  p1: "bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30",
  p2: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  p3: "bg-muted text-muted-foreground border-border",
};

// ── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  icon,
  color,
  sub,
}: {
  label: string;
  value: number | string;
  icon: React.ReactNode;
  color: string;
  sub?: string;
}) {
  return (
    <div className={cn("rounded-xl border bg-card p-5 flex flex-col gap-2", color)}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-muted-foreground opacity-60">{icon}</span>
      </div>
      <div className="text-3xl font-semibold tabular-nums leading-none">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Autonomy() {
  const { data: status } = useQuery<AutonomyStatus>({
    queryKey: ["/api/autonomy/status"],
    refetchInterval: 10_000,
  });

  const { data: timeline = [] } = useQuery<TimelineEntry[]>({
    queryKey: ["/api/autonomy/timeline"],
    refetchInterval: 30_000,
  });

  const { data: queue = [] } = useQuery<QueueEntry[]>({
    queryKey: ["/api/autonomy/queue"],
    refetchInterval: 30_000,
  });

  const { data: recentPrsData } = useQuery<{ prs: MergedPr[] }>({
    queryKey: ["/api/autonomy/recent-prs"],
    refetchInterval: 60_000,
  });

  const { data: ghIssues } = useQuery<GhIssuesResponse>({
    queryKey: ["/api/gh-issues"],
    refetchInterval: 60_000,
  });

  const { data: companionSignals } = useQuery<CompanionSignals>({
    queryKey: ["/api/companion-signals"],
    refetchInterval: 120_000,
  });

  const recentPrs = recentPrsData?.prs ?? [];

  // PRs merged in last 24h
  const cutoff24h = new Date(Date.now() - 86_400_000).toISOString();
  const prs24h = recentPrs.filter((pr) => pr.merged_at >= cutoff24h).length;

  // Open issues across repos
  const openIssues = ghIssues?.issues.filter((i) => i.state === "open").length ?? 0;

  // Chart data — last 6h (24 × 15min buckets)
  const chartData = buildChartData(timeline);

  // Timeline — last 20
  const recentTimeline = timeline.slice(0, 20);

  return (
    <Layout
      title="Autonomy Dashboard"
      subtitle="Real-time engine visibility — in-flight runs, draft queue, recent PRs. Auto-refreshes every 10–30s."
    >
      {/* ── KPI Row ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          label="In-flight Explorer"
          value={status?.in_flight.explorer ?? 0}
          icon={<Brain className="h-5 w-5" />}
          color="border-blue-500/30"
          sub={`cap: ${status?.auto_resume.explorer_max ?? "—"} · auto: ${status?.auto_resume.explorer ? "on" : "off"}`}
        />
        <KpiCard
          label="In-flight Executor"
          value={(status?.in_flight.executor ?? 0) + (status?.in_flight.ad_hoc ?? 0)}
          icon={<Cpu className="h-5 w-5" />}
          color="border-purple-500/30"
          sub={`cap: ${status?.auto_resume.executor_max ?? "—"} · auto: ${status?.auto_resume.executor ? "on" : "off"}`}
        />
        <KpiCard
          label="PRs merged 24h"
          value={prs24h}
          icon={<GitMerge className="h-5 w-5" />}
          color="border-emerald-500/30"
          sub={`${recentPrs.length} recent total`}
        />
        <KpiCard
          label="Open issues"
          value={openIssues}
          icon={<AlertCircle className="h-5 w-5" />}
          color="border-orange-500/30"
          sub="across 3 repos"
        />
      </div>

      {/* ── New lanes: PR Babysitter + Test-Debug + Companion Signals ────── */}
      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <section className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <GitPullRequest className="h-4 w-4 text-sky-500" />
            PR Babysitter
            <span className="text-[10px] normal-case font-normal">(event-triggered)</span>
          </h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Enabled</span>
              <span className={cn("font-medium", status?.pr_babysitter?.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                {status?.pr_babysitter?.enabled ? "on" : "off"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Last run</span>
              <span className="text-foreground">{status?.pr_babysitter?.last_run_at ? formatRelative(status.pr_babysitter.last_run_at) : "never"}</span>
            </div>
            {status?.pr_babysitter?.last_status && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <span className={cn("font-medium capitalize", status.pr_babysitter.last_status === "completed" ? "text-emerald-600 dark:text-emerald-400" : status.pr_babysitter.last_status === "failed" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>
                  {status.pr_babysitter.last_status}
                </span>
              </div>
            )}
            {status?.pr_babysitter?.last_pr_number && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Last PR</span>
                <span className="font-mono">#{status.pr_babysitter.last_pr_number}</span>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Bug className="h-4 w-4 text-orange-500" />
            Test-Debug
            <span className="text-[10px] normal-case font-normal">(every {status?.test_debug?.interval_hours ?? 4}h)</span>
          </h3>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Enabled</span>
              <span className={cn("font-medium", status?.test_debug?.enabled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                {status?.test_debug?.enabled ? "on" : "off"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Last run</span>
              <span className="text-foreground">{status?.test_debug?.last_run_at ? formatRelative(status.test_debug.last_run_at) : "never"}</span>
            </div>
            {status?.test_debug?.last_status && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Status</span>
                <span className={cn("font-medium capitalize", status.test_debug.last_status === "completed" ? "text-emerald-600 dark:text-emerald-400" : status.test_debug.last_status === "failed" ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400")}>
                  {status.test_debug.last_status}
                </span>
              </div>
            )}
            {status?.test_debug?.last_findings_count != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Findings</span>
                <span className="font-medium">{status.test_debug.last_findings_count}</span>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-card-border bg-card p-4">
          <h3 className="font-semibold text-xs uppercase tracking-wide text-muted-foreground mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-violet-500" />
            Companion signals
          </h3>
          {!companionSignals?.readiness ? (
            <div className="text-xs text-muted-foreground italic">Kalodata unreachable or not configured.</div>
          ) : (
            <div className="space-y-1.5">
              {companionSignals.readiness.slice(0, 5).map((item) => (
                <div key={item.category} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-muted-foreground truncate">{item.category}</div>
                    <div className="h-1.5 rounded-full bg-muted mt-0.5 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", item.completion_pct >= 80 ? "bg-emerald-500" : item.completion_pct >= 50 ? "bg-amber-500" : "bg-rose-500")}
                        style={{ width: `${item.completion_pct}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[10px] font-mono shrink-0 text-muted-foreground">{item.completion_pct}%</span>
                </div>
              ))}
              {companionSignals.roadmapState?.current_phase && (
                <div className="mt-2 pt-2 border-t border-card-border text-[10px] text-muted-foreground">
                  Phase: <span className="text-foreground font-medium">{companionSignals.roadmapState.current_phase}</span>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* ── Stacked area chart — in-flight over last 6h ─────────────────── */}
      <section className="rounded-xl border border-card-border bg-card p-5 mb-6">
        <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          In-flight runs — last 6 hours (15-min buckets)
        </h2>
        {timeline.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground italic">
            No run data yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={chartData} margin={{ top: 4, right: 16, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradExplorer" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="gradExecutor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#a855f7" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#a855f7" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" strokeOpacity={0.4} />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(var(--foreground))", fontWeight: 600 }}
              />
              <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
              <Area
                type="monotone"
                dataKey="Explorer"
                stackId="1"
                stroke="#3b82f6"
                strokeWidth={1.5}
                fill="url(#gradExplorer)"
              />
              <Area
                type="monotone"
                dataKey="Executor"
                stackId="1"
                stroke="#a855f7"
                strokeWidth={1.5}
                fill="url(#gradExecutor)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </section>

      {/* ── Bottom grid: Timeline + Queue ─────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Recent runs timeline */}
        <section className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Recent runs
            <span className="text-xs font-normal text-muted-foreground">(last 20)</span>
          </h2>
          {recentTimeline.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No runs recorded yet.</div>
          ) : (
            <ul className="divide-y divide-card-border">
              {recentTimeline.map((r) => {
                const Icon = STATUS_ICON[r.status] ?? Clock;
                const isExplorer = r.kind === "explorer";
                return (
                  <li key={r.id} className="py-2.5 flex items-center gap-3">
                    <Icon className={cn("h-3.5 w-3.5 shrink-0", STATUS_TONE[r.status] ?? "text-muted-foreground")} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0",
                            isExplorer
                              ? "bg-blue-500/15 text-blue-700 dark:text-blue-300"
                              : "bg-purple-500/15 text-purple-700 dark:text-purple-300",
                          )}
                        >
                          {isExplorer ? "Explorer" : r.kind === "executor_cron" ? "Executor" : "Ad-hoc"}
                        </span>
                        <span className="text-xs truncate text-foreground">{r.label}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span>{formatRelative(r.started_at)}</span>
                        {r.duration_ms > 0 && (
                          <span className="opacity-70">· {durationLabel(r.duration_ms)}</span>
                        )}
                        {r.lane && <span className="opacity-60 truncate">· {r.lane}</span>}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded border",
                        r.status === "completed"
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : r.status === "running"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : r.status === "failed"
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300"
                          : "border-border bg-muted text-muted-foreground",
                      )}
                    >
                      {r.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* EV-sorted draft queue */}
        <section className="rounded-xl border border-card-border bg-card p-5">
          <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            Draft queue — EV sorted
            <span className="text-xs font-normal text-muted-foreground">(top 15 proposed)</span>
          </h2>
          {queue.length === 0 ? (
            <div className="text-sm text-muted-foreground italic">No proposed drafts in queue.</div>
          ) : (
            <ul className="divide-y divide-card-border">
              {queue.map((item, i) => (
                <li key={item.id} className="py-2.5 flex items-start gap-3">
                  <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0 pt-0.5 tabular-nums">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs leading-snug line-clamp-2">{item.title}</div>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {item.area && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {item.area}
                        </span>
                      )}
                      <span
                        className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded border font-medium",
                          PRIORITY_BADGE[item.priority] ?? PRIORITY_BADGE.p3,
                        )}
                      >
                        {item.priority.toUpperCase()}
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] tabular-nums font-mono text-muted-foreground shrink-0 pt-0.5">
                    ev {typeof item.ev_score === "number" ? item.ev_score.toFixed(1) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── Recent merged PRs ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-card-border bg-card p-5">
        <h2 className="font-semibold text-sm mb-4 flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-emerald-500" />
          Recently merged PRs
          <span className="text-xs font-normal text-muted-foreground">(last 10 across 3 repos)</span>
        </h2>
        {recentPrs.length === 0 ? (
          <div className="text-sm text-muted-foreground italic">No merged PRs found — GitHub token may not be configured.</div>
        ) : (
          <ul className="divide-y divide-card-border">
            {recentPrs.map((pr) => (
              <li key={`${pr.repo}-${pr.number}`} className="py-2.5 flex items-start gap-3">
                <GitMerge className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-500" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs leading-snug flex items-center gap-1.5">
                    <a
                      href={pr.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline text-foreground truncate"
                    >
                      {pr.title}
                    </a>
                    <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono">{pr.repo.split("/")[1]}</span>
                    <span>#{pr.number}</span>
                    {pr.author && <span>by {pr.author}</span>}
                    <span>· {formatRelative(pr.merged_at)}</span>
                  </div>
                </div>
                {pr.labels.slice(0, 2).map((label) => (
                  <span
                    key={label}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
                  >
                    {label}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
