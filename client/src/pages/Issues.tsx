import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { ExternalLink, GitPullRequest, MessageSquare, RefreshCw, Github, AlertCircle, Filter, CircleDot, CheckCircle2, ChevronRight, ChevronDown } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

type GhIssue = {
  number: number;
  title: string;
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  author: string | null;
  labels: string[];
  comments: number;
  pr_url: string | null;
  body_excerpt: string;
  html_url: string;
  repo: string;
};

type IssuesResp = {
  issues: GhIssue[];
  repos: string[];
  errors: string[];
  fetched_at: string;
};

const PRIORITY_DOT: Record<string, string> = {
  "priority:p0": "bg-rose-500",
  "priority:p1": "bg-amber-500",
  "priority:p2": "bg-sky-500",
  "priority:p3": "bg-muted-foreground",
};

const PRIORITY_TEXT: Record<string, string> = {
  "priority:p0": "text-rose-700 dark:text-rose-400",
  "priority:p1": "text-amber-700 dark:text-amber-400",
  "priority:p2": "text-sky-700 dark:text-sky-400",
  "priority:p3": "text-muted-foreground",
};

export default function Issues() {
  const queryClient = useQueryClient();
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [labelFilter, setLabelFilter] = useState<string>("");
  const [repoFilter, setRepoFilter] = useState<string>("all");

  const queryString = labelFilter ? `?state=${state}&labels=${encodeURIComponent(labelFilter)}` : `?state=${state}`;
  const { data, isFetching, isError, error, refetch } = useQuery<IssuesResp>({
    queryKey: [`/api/gh-issues${queryString}`],
    refetchInterval: 60_000,
  });

  const reconcile = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", "/api/draft-tasks/reconcile-from-github", {});
      if (!r.ok) throw new Error((await r.json()).error || "reconcile failed");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gh-issues${queryString}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/draft-tasks"] });
    },
  });

  // Auto-sync to local Backlog DB on mount
  useEffect(() => {
    reconcile.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const issues = data?.issues ?? [];
  const repos = data?.repos ?? [];

  const filtered = useMemo(() => {
    if (repoFilter === "all") return issues;
    return issues.filter((i) => i.repo === repoFilter);
  }, [issues, repoFilter]);

  // Group issues into trackers (master) vs children vs solo, GitHub-epic style
  const groups = useMemo(() => {
    const trackers = filtered.filter((i) => i.labels.includes("tracker"));
    const others = filtered.filter((i) => !i.labels.includes("tracker"));

    // For each tracker, find children whose body references its number (e.g. "Parent: #37" or "#37")
    // Approximation: match by area-label since the Hub clusters by area
    const trackerToChildren = new Map<number, GhIssue[]>();
    const claimedChildren = new Set<number>();

    // Two-pass match. Pass 1: anything whose body explicitly references this tracker number
    // (e.g. "Parent: #37" or just "#37") is a child. This is the strong signal and we trust
    // it across area/priority drift. Pass 2: same area + same priority is a soft signal that
    // we use only when the body doesn't claim a different parent.
    const otherClaimsParent = new Map<number, number>(); // child -> declared parent #
    for (const o of others) {
      const m = o.body_excerpt.match(/(?:Parent|Tracker|Master)\s*[:=]?\s*#(\d+)/i) ||
                o.body_excerpt.match(/^>?\s*#(\d+)\b/m);
      if (m) otherClaimsParent.set(o.number, parseInt(m[1], 10));
    }

    for (const t of trackers) {
      const tArea = t.labels.find((l) => l.startsWith("area:"));
      const children: GhIssue[] = [];
      for (const o of others) {
        if (claimedChildren.has(o.number)) continue;
        if (o.repo !== t.repo) continue;

        // Strong signal: child body explicitly cites this tracker number anywhere
        // (handles checkbox-list trackers and prose like "see #37").
        const declaredParent = otherClaimsParent.get(o.number);
        const explicitMatch =
          declaredParent === t.number ||
          o.body_excerpt.includes(`#${t.number}`) ||
          o.body_excerpt.includes(`Parent: #${t.number}`) ||
          o.body_excerpt.includes(`Tracker: #${t.number}`);

        // Soft signal: same area, no other explicit parent claim. We don't require
        // priority match anymore because trackers and children often diverge
        // (e.g. P1 tracker with P0 hot-fix child).
        const oArea = o.labels.find((l) => l.startsWith("area:"));
        const softMatch =
          !!tArea && oArea === tArea &&
          (!declaredParent || declaredParent === t.number);

        if (explicitMatch || softMatch) {
          children.push(o);
          claimedChildren.add(o.number);
        }
      }
      trackerToChildren.set(t.number, children);
    }

    const solos = others.filter((i) => !claimedChildren.has(i.number));
    return { trackers, trackerToChildren, solos };
  }, [filtered]);

  const stats = useMemo(() => ({
    total: filtered.length,
    open: filtered.filter((i) => i.state === "open").length,
    closed: filtered.filter((i) => i.state === "closed").length,
    autonomyHub: filtered.filter((i) => i.labels.includes("autonomy-hub")).length,
    tracker: groups.trackers.length,
    p0: filtered.filter((i) => i.labels.includes("priority:p0")).length,
    p1: filtered.filter((i) => i.labels.includes("priority:p1")).length,
  }), [filtered, groups]);

  return (
    <Layout
      title="GitHub Issues"
      subtitle={
        repos.length
          ? `Live from ${repos.join(" + ")}${data?.fetched_at ? ` · last fetched ${new Date(data.fetched_at).toLocaleTimeString()}` : ""}`
          : "Loading repos…"
      }
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => reconcile.mutate()}
            disabled={reconcile.isPending}
            className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent disabled:opacity-50"
          >
            <Github className="h-3.5 w-3.5" /> {reconcile.isPending ? "Syncing…" : "Sync to Backlog"}
          </button>
          <button onClick={() => refetch()} disabled={isFetching} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-card-border hover:bg-accent">
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Refresh
          </button>
        </div>
      }
    >
      {isError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 mb-4 text-sm text-rose-700 dark:text-rose-400">
          <AlertCircle className="h-4 w-4 inline mr-2" />
          {(error as any)?.message || "Failed to fetch issues. Make sure GitHub PAT is configured in Explorer Settings."}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-7 gap-3 mb-6">
        <Stat label="Total" value={stats.total} />
        <Stat label="Open" value={stats.open} tone={stats.open > 0 ? "warn" : undefined} />
        <Stat label="Closed" value={stats.closed} tone="good" />
        <Stat label="Autonomy Hub" value={stats.autonomyHub} sub="filed by Hub" />
        <Stat label="Trackers" value={stats.tracker} sub="master clusters" />
        <Stat label="P0" value={stats.p0} tone={stats.p0 > 0 ? "bad" : undefined} />
        <Stat label="P1" value={stats.p1} />
      </div>

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-1 border border-input rounded-md overflow-hidden text-xs">
          {(["open", "closed", "all"] as const).map((s) => (
            <button key={s} onClick={() => setState(s)} className={cn("px-3 py-1.5 transition-colors capitalize", state === s ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
              {s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 border border-input rounded-md overflow-hidden text-xs">
          <button onClick={() => setRepoFilter("all")} className={cn("px-3 py-1.5 transition-colors", repoFilter === "all" ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")}>
            All repos
          </button>
          {repos.map((r) => (
            <button key={r} onClick={() => setRepoFilter(r)} className={cn("px-3 py-1.5 transition-colors font-mono", repoFilter === r ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent")} title={r}>
              {r.includes("frontend") ? "frontend" : r.includes("backend") ? "backend" : r.split("/").pop()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <Filter className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Filter by labels (comma-sep)"
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value)}
            className="px-2 py-1.5 rounded-md border border-input bg-background text-sm w-72"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-card-border bg-card p-10 text-center">
          <Github className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <div className="text-sm font-medium">No {state} issues</div>
          <p className="text-xs text-muted-foreground mt-1">
            Try changing the state filter, or wait for the Explorer cron to file new issues.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Master trackers as expanded epic cards.
              Note: we use a non-`children` prop name for the children-issues array so React
              doesn't conflate it with the JSX children slot. */}
          {groups.trackers.map((t) => (
            <TrackerCard key={`${t.repo}-${t.number}`} tracker={t} childIssues={groups.trackerToChildren.get(t.number) ?? []} />
          ))}

          {/* Solo / non-tracker issues as flat list, GitHub-style */}
          {groups.solos.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 px-1">
                Solo issues ({groups.solos.length})
              </h3>
              <div className="rounded-lg border border-card-border bg-card overflow-hidden divide-y divide-card-border">
                {groups.solos.map((i) => <IssueRow key={`${i.repo}-${i.number}`} issue={i} compact />)}
              </div>
            </section>
          )}
        </div>
      )}
    </Layout>
  );
}

function TrackerCard({ tracker, childIssues }: { tracker: GhIssue; childIssues: GhIssue[] }) {
  const [expanded, setExpanded] = useState(true);
  const priorityLabel = tracker.labels.find((l) => l.startsWith("priority:")) ?? "";
  const areaLabel = tracker.labels.find((l) => l.startsWith("area:"));
  const repoShort = tracker.repo.includes("frontend") ? "frontend" : "backend";
  const closedChildren = childIssues.filter((c) => c.state === "closed").length;
  const totalChildren = childIssues.length;
  const progressPct = totalChildren > 0 ? Math.round((closedChildren / totalChildren) * 100) : 0;

  return (
    <section className="rounded-lg border-2 border-purple-500/40 bg-card overflow-hidden shadow-sm">
      <header className="bg-purple-500/5 px-4 py-3 border-b border-purple-500/20">
        <div className="flex items-start gap-3">
          <button onClick={() => setExpanded(!expanded)} className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-700 dark:text-purple-400">
                Tracker
              </span>
              <span className="text-[10px] font-mono text-muted-foreground">{repoShort} · #{tracker.number}</span>
              {priorityLabel && (
                <span className={cn("text-[10px] font-semibold uppercase tracking-wide", PRIORITY_TEXT[priorityLabel])}>
                  {priorityLabel.replace("priority:", "")}
                </span>
              )}
              {areaLabel && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  {areaLabel.replace("area:", "")}
                </span>
              )}
              <span className={cn(
                "text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded",
                tracker.state === "open" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-purple-500/15 text-purple-700 dark:text-purple-400"
              )}>
                {tracker.state}
              </span>
            </div>
            <a href={tracker.html_url} target="_blank" rel="noreferrer" className="block mt-1 text-base font-semibold hover:text-primary leading-snug">
              {tracker.title}
            </a>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span>{closedChildren} / {totalChildren} children closed ({progressPct}%)</span>
              {tracker.comments > 0 && (
                <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" /> {tracker.comments}</span>
              )}
              <span>updated {relativeTime(new Date(tracker.updated_at))}</span>
              <a href={tracker.html_url} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 hover:text-foreground">
                View on GitHub <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {totalChildren > 0 && (
              <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${progressPct}%` }} />
              </div>
            )}
          </div>
        </div>
      </header>
      {expanded && (
        <>
          {tracker.body_excerpt && (
            <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/10 border-b border-card-border">
              {tracker.body_excerpt.replace(/^>\s.*$/gm, "").trim().slice(0, 220)}
            </div>
          )}
          {childIssues.length === 0 ? (
            <div className="px-4 py-4 text-xs text-muted-foreground italic">
              No detected children. (Tracker may use checkbox-only references, or its children may already be closed.)
            </div>
          ) : (
            <div className="divide-y divide-card-border">
              {childIssues.map((c) => <IssueRow key={`${c.repo}-${c.number}`} issue={c} compact indent />)}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function IssueRow({ issue, compact, indent }: { issue: GhIssue; compact?: boolean; indent?: boolean }) {
  const isAutonomy = issue.labels.includes("autonomy-hub");
  const priorityLabel = issue.labels.find((l) => l.startsWith("priority:")) ?? "";
  const areaLabel = issue.labels.find((l) => l.startsWith("area:"));
  const repoShort = issue.repo.includes("frontend") ? "FE" : "BE";
  const ageStr = relativeTime(new Date(issue.updated_at));

  return (
    <div className={cn(
      "flex items-start gap-3 px-4 py-3 hover:bg-accent/30 group",
      indent && "pl-10",
    )}>
      {issue.state === "open" ? (
        <CircleDot className={cn("h-4 w-4 mt-0.5 shrink-0", "text-emerald-600 dark:text-emerald-500")} />
      ) : (
        <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-purple-600 dark:text-purple-500" />
      )}
      <div className="flex-1 min-w-0">
        <a href={issue.html_url} target="_blank" rel="noreferrer" className="text-sm font-medium hover:text-primary leading-snug">
          {issue.title}
        </a>
        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
          <span className="font-mono">{repoShort} #{issue.number}</span>
          <span>opened {relativeTime(new Date(issue.created_at))} by {issue.author ?? "?"}</span>
          {priorityLabel && (
            <span className={cn("inline-flex items-center gap-1", PRIORITY_TEXT[priorityLabel])}>
              <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_DOT[priorityLabel])} />
              {priorityLabel.replace("priority:", "").toUpperCase()}
            </span>
          )}
          {areaLabel && (
            <span className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px]">{areaLabel.replace("area:", "")}</span>
          )}
          {isAutonomy && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px]">autonomy-hub</span>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0 text-[11px] text-muted-foreground">
        <span>{ageStr}</span>
        {issue.comments > 0 && (
          <span className="inline-flex items-center gap-0.5"><MessageSquare className="h-3 w-3" /> {issue.comments}</span>
        )}
        {issue.pr_url && (
          <a href={issue.pr_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline">
            <GitPullRequest className="h-3 w-3" /> PR
          </a>
        )}
      </div>
    </div>
  );
}

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function Stat({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const ring = tone === "good" ? "border-emerald-500/40" : tone === "warn" ? "border-amber-500/40" : tone === "bad" ? "border-rose-500/40" : "border-card-border";
  return (
    <div className={cn("rounded-lg border bg-card p-3", ring)}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
