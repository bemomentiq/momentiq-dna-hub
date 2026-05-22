import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { registerExplorerRoutes } from "./explorer/routes";
import { registerFleetRoutes } from "./explorer/fleet-routes";
import { registerDispatchRoutes } from "./explorer/dispatch-log";
import { registerPrBabysitterRoutes } from "./explorer/pr-babysitter";
import { registerTestDebugRoutes } from "./explorer/test-debug";
import { registerSkillsRoutes } from "./explorer/skills";
import { startAutoResumer, startReaper, lastReapedCount, lastReapedAt } from "./explorer/auto-resume";
import { computeCascadeStats } from "./explorer/cascade-dispatch";
import { fetchKalodataSignals } from "./explorer/kalodata-signals";
import { dispatchConsolidationToCC } from "./explorer/consolidation";
import { dispatchOrganizerToCC, computeExplorerPauseDecision, type OrganizerScope } from "./explorer/backlog-organizer";
import { storage } from "./storage";
import { buildDigestMarkdown } from "./digest";
import { dnaClient } from "./clients/dna";
import { scriptsageClient } from "./clients/scriptsage";
import { checkDnaHealth, checkScriptsageHealth, checkKalodataHealth } from "./clients/health";
import { cacheStats, cacheBust } from "./clients/cache";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  registerExplorerRoutes(app);
  registerFleetRoutes(app);
  registerPrBabysitterRoutes(app);
  registerTestDebugRoutes(app);
  registerSkillsRoutes(app);
  // Always-on auto-resume loop (checks every 30s, respects cron_config flags)
  startAutoResumer();
  startReaper();
  registerDispatchRoutes(app);

  // Live GitHub issues — pulls from both configured target repos.
  // Replaces the old static action-linked-issues view. Returns issues with their
  // full label set + state + recent comments count + linked PR if any.
  app.get("/api/gh-issues", async (req, res) => {
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      return void res.status(400).json({ error: "GitHub token not configured" });
    }
    // Content platform: pull issues across momentiq-dna, dna-hub, scriptsage-{backend,frontend}.
    // Keep default_gh_repo/frontend_gh_repo for backwards compat; merge + dedupe.
    const contentRepos = [
      "bemomentiq/momentiq-dna",
      "bemomentiq/momentiq-dna-hub",
      "bemomentiq/momentiq-scriptsage-backend",
      "bemomentiq/momentiq-scriptsage-frontend",
    ];
    const reposRaw = [cfg.default_gh_repo, cfg.frontend_gh_repo, ...contentRepos].filter(Boolean);
    const repos = Array.from(new Set(reposRaw));
    const state = (req.query.state as string) || "open";
    const labels = (req.query.labels as string) || ""; // comma-sep, default = all
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    type Issue = {
      number: number; title: string; state: string; created_at: string; updated_at: string;
      author: string | null; labels: string[]; comments: number; pr_url: string | null;
      body_excerpt: string; html_url: string; repo: string;
    };
    const all: Issue[] = [];
    const errors: string[] = [];

    for (const repo of repos) {
      try {
        const params = new URLSearchParams({
          state,
          per_page: "100",
          sort: "updated",
          direction: "desc",
        });
        if (labels) params.set("labels", labels);
        const r = await fetch(`https://api.github.com/repos/${repo}/issues?${params}`, { headers });
        if (!r.ok) {
          errors.push(`${repo} ${r.status}`);
          continue;
        }
        const items = (await r.json()) as any[];
        for (const i of items) {
          if (i.pull_request) continue; // GH /issues includes PRs; filter them
          all.push({
            number: i.number,
            title: i.title,
            state: i.state,
            created_at: i.created_at,
            updated_at: i.updated_at,
            author: i.user?.login ?? null,
            labels: (i.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean),
            comments: i.comments ?? 0,
            pr_url: i.pull_request?.html_url ?? null,
            body_excerpt: (i.body || "").slice(0, 240),
            html_url: i.html_url,
            repo,
          });
        }
      } catch (err: any) {
        errors.push(`${repo}: ${err?.message ?? err}`);
      }
    }
    // Sort by updated_at desc across both repos
    all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json({ issues: all, repos, errors, fetched_at: new Date().toISOString() });
  });

  // Live roadmap: GitHub milestones + epic:* labelled issues across the 4 content repos.
  // Groups issues by epic:* label; non-fatal per-repo errors are surfaced in `errors`.
  app.get("/api/content-platform/roadmap", async (_req, res) => {
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      return void res.status(400).json({ error: "GitHub token not configured" });
    }
    const repos = [
      "bemomentiq/momentiq-dna",
      "bemomentiq/momentiq-dna-hub",
      "bemomentiq/momentiq-scriptsage-backend",
      "bemomentiq/momentiq-scriptsage-frontend",
    ];
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    type Milestone = {
      repo: string;
      number: number;
      title: string;
      description: string | null;
      state: string;
      open_issues: number;
      closed_issues: number;
      due_on: string | null;
      html_url: string;
    };
    type EpicIssue = {
      repo: string;
      number: number;
      title: string;
      state: string;
      html_url: string;
      labels: string[];
      updated_at: string;
    };
    type EpicGroup = {
      label: string;
      title: string;
      description: string;
      open: number;
      closed: number;
      total: number;
      issues: EpicIssue[];
      html_url: string;
    };

    const milestones: Milestone[] = [];
    const epicMap = new Map<string, EpicGroup>();
    const errors: string[] = [];

    for (const repo of repos) {
      // Milestones (open + closed)
      try {
        const r = await fetch(
          `https://api.github.com/repos/${repo}/milestones?state=all&per_page=100&sort=due_on&direction=asc`,
          { headers },
        );
        if (!r.ok) {
          errors.push(`${repo} milestones ${r.status}`);
        } else {
          const items = (await r.json()) as any[];
          for (const m of items) {
            milestones.push({
              repo,
              number: m.number,
              title: m.title,
              description: m.description ?? null,
              state: m.state,
              open_issues: m.open_issues ?? 0,
              closed_issues: m.closed_issues ?? 0,
              due_on: m.due_on ?? null,
              html_url: m.html_url,
            });
          }
        }
      } catch (err: any) {
        errors.push(`${repo} milestones: ${err?.message ?? err}`);
      }

      // Epic-labelled issues: discover epic:* labels per-repo, then query issues
      // server-side by label so groups aren't truncated to the latest 100.
      const epicLabelsForRepo: string[] = [];
      try {
        for (let page = 1; page <= 5; page++) {
          const r = await fetch(
            `https://api.github.com/repos/${repo}/labels?per_page=100&page=${page}`,
            { headers },
          );
          if (!r.ok) {
            errors.push(`${repo} labels ${r.status}`);
            break;
          }
          const items = (await r.json()) as any[];
          if (!items.length) break;
          for (const l of items) {
            const name: string | undefined = l?.name;
            if (name && name.startsWith("epic:")) epicLabelsForRepo.push(name);
          }
          if (items.length < 100) break;
        }
      } catch (err: any) {
        errors.push(`${repo} labels: ${err?.message ?? err}`);
      }

      // Dedupe per (repo, number) in case an issue carries multiple epic labels
      // and the API returns it for each label query.
      const seen = new Set<string>();
      for (const epicLabel of epicLabelsForRepo) {
        try {
          for (let page = 1; page <= 5; page++) {
            const params = new URLSearchParams({
              labels: epicLabel,
              state: "all",
              per_page: "100",
              page: String(page),
            });
            const r = await fetch(
              `https://api.github.com/repos/${repo}/issues?${params}`,
              { headers },
            );
            if (!r.ok) {
              errors.push(`${repo} issues label=${epicLabel} ${r.status}`);
              break;
            }
            const items = (await r.json()) as any[];
            if (!items.length) break;
            for (const i of items) {
              if (i.pull_request) continue;
              const labels: string[] = (i.labels || [])
                .map((l: any) => (typeof l === "string" ? l : l.name))
                .filter(Boolean);
              const issueEpicLabels = labels.filter((l) => l.startsWith("epic:"));
              if (issueEpicLabels.length === 0) continue;
              for (const el of issueEpicLabels) {
                const dedupeKey = `${repo}#${i.number}@${el}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                let group = epicMap.get(el);
                if (!group) {
                  group = {
                    label: el,
                    title: el
                      .slice(5)
                      .split(/[-_]/)
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" "),
                    description: "",
                    open: 0,
                    closed: 0,
                    total: 0,
                    issues: [],
                    html_url: `https://github.com/search?q=label%3A%22${encodeURIComponent(el)}%22+org%3Abemomentiq&type=issues`,
                  };
                  epicMap.set(el, group);
                }
                if (i.state === "open") group.open += 1;
                else group.closed += 1;
                group.total += 1;
                group.issues.push({
                  repo,
                  number: i.number,
                  title: i.title,
                  state: i.state,
                  html_url: i.html_url,
                  labels,
                  updated_at: i.updated_at,
                });
              }
            }
            if (items.length < 100) break;
          }
        } catch (err: any) {
          errors.push(`${repo} issues label=${epicLabel}: ${err?.message ?? err}`);
        }
      }
    }

    const epics = Array.from(epicMap.values())
      .map((e) => ({
        ...e,
        issues: e.issues.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))
      .sort((a, b) => b.total - a.total);

    milestones.sort((a, b) => {
      if (a.state !== b.state) return a.state === "open" ? -1 : 1;
      const ad = a.due_on ?? "9999";
      const bd = b.due_on ?? "9999";
      return ad.localeCompare(bd);
    });

    res.json({ milestones, epics, repos, errors, fetched_at: new Date().toISOString() });
  });

  // Content-platform overview: aggregates dna corpus + A/B activity + ScriptSage
  // throughput + subscriptions + open issues across the 4 content repos.
  // Each upstream call returns null when its base URL env var is unset, so the
  // endpoint never crashes — clients render empty-states per section.
  app.get("/api/content-platform/overview", async (_req, res) => {
    const [corpus, abRuns, veo, ids, ssStats, ssSubs] = await Promise.all([
      dnaClient.corpus(),
      dnaClient.abRuns({ status: "running", limit: 50 }),
      dnaClient.veoCost(7),
      dnaClient.idsDistribution(7),
      scriptsageClient.stats(),
      scriptsageClient.subscriptions(),
    ]);
    const overall = ids?.distributions.find((d) => d.dimension === "overall") ?? null;
    res.json({
      dna_configured: dnaClient.configured(),
      scriptsage_configured: scriptsageClient.configured(),
      corpus,
      ab_runs_active: abRuns?.runs.length ?? null,
      ids_median_7d: overall?.median ?? null,
      veo_spend_7d_usd: veo?.total_cost_usd ?? null,
      scriptsage: ssStats,
      subscriptions: ssSubs,
      fetched_at: new Date().toISOString(),
    });
  });

  // Themes & Champions: proxies dnaClient.themes() with dna_configured flag so
  // the client can render an empty-state when DNA_API_BASE is unset.
  app.get("/api/content-platform/themes", async (_req, res) => {
    const result = await dnaClient.themes();
    res.json({
      themes: result?.themes ?? [],
      dna_configured: dnaClient.configured(),
    });
  });

  // Per-theme drill-down: champion config + variants (A/B runs).
  // Returns { dna_configured, theme, variants } so the client can render an
  // empty-state when DNA_API_BASE is unset, instead of 502'ing.
  app.get("/api/content-platform/themes/:slug", async (req, res) => {
    const data = await dnaClient.theme(req.params.slug);
    res.json({
      dna_configured: dnaClient.configured(),
      slug: req.params.slug,
      theme: data?.theme ?? null,
      variants: data?.variants ?? null,
      fetched_at: new Date().toISOString(),
    });
  });

  // Reachability probes for upstream content-platform services. Bypasses the
  // read cache — sidebar pill / monitors should see live status.
  app.get("/api/content-platform/health", async (_req, res) => {
    const cfg = storage.getCronConfig() as any;
    const companionUrl = cfg.companion_site_url || process.env.KALODATA_API_URL || "";
    const [dna, ss, kalo] = await Promise.all([
      checkDnaHealth(),
      checkScriptsageHealth(),
      companionUrl ? checkKalodataHealth(companionUrl) : Promise.resolve({
        configured: false,
        reachable: null,
        latency_ms: null,
        checked_at: new Date().toISOString(),
        error: null,
      }),
    ]);
    res.json({ dna, scriptsage: ss, kalodata: kalo, fetched_at: new Date().toISOString() });
  });

  // Cache introspection + bust (ops-only; useful from the autonomy page).
  app.get("/api/content-platform/cache", (_req, res) => {
    res.json(cacheStats());
  });
  app.post("/api/content-platform/cache/bust", (req, res) => {
    const prefix = (req.query.prefix as string) || undefined;
    const n = cacheBust(prefix);
    res.json({ busted: n, prefix: prefix ?? "(all)" });
  });

  // SID-era endpoints removed during content-platform redesign:
  // /api/actions, /api/actions/:name, /api/rollups, /api/hitl-burden,
  // /api/feed, /api/money-path, /api/data-pipeline.
  // Replacements live under /api/content-platform/* (themes, ab-runs,
  // ids-distribution, veo-cost, scriptsage, subscriptions, roadmap).

  // /api/roadmap (hardcoded A–G phases) and /api/exec-brief.md (SID rollups)
  // removed during content-platform redesign. New equivalents:
  //   /api/content-platform/roadmap  (live GitHub milestones across 4 repos)
  //   /api/content-platform/overview (corpus / A/B / IDS / Veo / ScriptSage)
  //   /api/content-platform/promotion-candidates

  // SID-era endpoints removed during content-platform redesign:
  // /api/actions, /api/actions/:name, /api/rollups, /api/hitl-burden,
  // /api/feed, /api/money-path, /api/data-pipeline.
  // Replacements live under /api/content-platform/* (themes, ab-runs,
  // ids-distribution, veo-cost, scriptsage, subscriptions, roadmap).

  // /api/roadmap (hardcoded A–G phases) and /api/exec-brief.md (SID rollups)
  // removed during content-platform redesign. New equivalents:
  //   /api/content-platform/roadmap  (live GitHub milestones across 4 repos)
  //   /api/content-platform/overview (corpus / A/B / IDS / Veo / ScriptSage)
  //   /api/content-platform/promotion-candidates

  // ============ Autonomy status ============
  // Snapshot of the always-on engine: resume flags, concurrency caps, in-flight counts.
  app.get("/api/autonomy/status", (_req, res) => {
    const cfg = storage.getCronConfigSafe() as any;
    const explorerInFlight = storage.listRuns(50).filter((r) => r.status === "running" || r.status === "queued" || r.status === "planning").length;
    const executorInFlight = storage.listFleetRuns({ kind: "executor_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "executor_cron", status: "queued" }).length
      + storage.listFleetRuns({ kind: "executor_cron", status: "planning" as any }).length;
    const adHocInFlight = storage.listFleetRuns({ kind: "ad_hoc", status: "running" }).length;
    const auditInFlight = storage.listFleetRuns({ kind: "audit_cron", status: "running" }).length
      + storage.listFleetRuns({ kind: "audit_cron", status: "queued" }).length;
    const lastExplorer = storage.listRuns(1)[0];
    const lastExecutor = storage.listFleetRuns({ kind: "executor_cron", limit: 1 })[0];
    const lastAudit = storage.listFleetRuns({ kind: "audit_cron", limit: 1 })[0];
    const db = storage.getDb();
    const lastTestDebug = (db as any).prepare("SELECT * FROM test_debug_runs ORDER BY id DESC LIMIT 1").get() as any;
    const lastPrBabysitter = (db as any).prepare("SELECT * FROM pr_babysitter_runs ORDER BY id DESC LIMIT 1").get() as any;
    res.json({
      auto_resume: {
        explorer: !!cfg.auto_resume_explorer,
        executor: !!cfg.auto_resume_executor,
        max_concurrent: cfg.auto_resume_max_concurrent,
        min_gap_sec: cfg.auto_resume_min_gap_sec,
        // Per-kind caps + master loop toggle (AH-PHASE4-2)
        autonomous_indefinite_loop: cfg.autonomous_indefinite_loop !== false,
        explorer_max: cfg.auto_resume_explorer_max ?? 3,
        executor_max: cfg.auto_resume_executor_max ?? 3,
      },
      mini5_fallback_enabled: !!cfg.mini5_fallback_enabled,
      in_flight: { explorer: explorerInFlight, executor: executorInFlight, ad_hoc: adHocInFlight },
      last_explorer: lastExplorer ? { id: lastExplorer.id, status: lastExplorer.status, started_at: lastExplorer.started_at } : null,
      last_executor: lastExecutor ? { id: lastExecutor.id, status: lastExecutor.status, started_at: lastExecutor.started_at, pr_url: lastExecutor.gh_pr_url } : null,
      audit: {
        enabled: !!(cfg as any).auto_resume_audit,
        max: (cfg as any).auto_resume_audit_max ?? 1,
        interval_hours: (cfg as any).audit_interval_hours ?? 6,
        in_flight: auditInFlight,
        last_run_at: lastAudit?.started_at ?? null,
        last_status: lastAudit?.status ?? null,
      },
      test_debug: {
        enabled: !!(cfg as any).auto_resume_test_debug,
        max: (cfg as any).auto_resume_test_debug_max ?? 1,
        interval_hours: (cfg as any).test_debug_interval_hours ?? 4,
        last_run_at: lastTestDebug?.started_at ?? null,
        last_status: lastTestDebug?.status ?? null,
        last_findings_count: lastTestDebug?.findings_count ?? null,
      },
      pr_babysitter: {
        enabled: !!(cfg as any).pr_babysitter_enabled,
        last_run_at: lastPrBabysitter?.started_at ?? null,
        last_status: lastPrBabysitter?.status ?? null,
        last_pr_number: lastPrBabysitter?.pr_number ?? null,
      },
      consolidation: {
        enabled: !!(cfg as any).consolidation_cron_enabled,
        interval_hours: (cfg as any).consolidation_cron_interval_hours ?? 1,
        last_run_at: (cfg as any).consolidation_last_run_at ?? null,
        last_cc_task_id: (cfg as any).consolidation_last_cc_task_id ?? null,
      },
      reaper: {
        stale_run_max_age_sec: cfg.stale_run_max_age_sec ?? 2400,
        last_reaped_count: lastReapedCount,
        last_reaped_at: lastReapedAt,
      },
      cascade_stats: (() => {
        // Count last 50 runs across fleet + explorer runs by mini×provider
        const fleetMarkers = storage.listFleetRuns({ limit: 50 }).map((r) => (r as any).direct_marker ?? null);
        const explorerMarkers = storage.listRuns(50).map((r) =>
          r.error?.startsWith("direct:") ? r.error.replace(/^direct:/, "") : null
        );
        return computeCascadeStats([...fleetMarkers, ...explorerMarkers]);
      })(),
      ts: new Date().toISOString(),
    });
  });

  // ============ Companion site signals ============
  app.get("/api/companion-signals", async (_req, res) => {
    const signals = await fetchKalodataSignals();
    res.json(signals);
  });

  // ============ Readiness snapshot (companion API proxy + persist) ============
  app.get("/api/readiness-snapshot", async (_req, res) => {
    try {
      const cfg = storage.getCronConfig();
      const companionUrl = (cfg as any).companion_site_url || "https://kalodata-ai-content-platform-t.pplx.app";
      const snap = await fetch(`${companionUrl}/api/readiness`).then(r => r.json()).catch(() => null);
      const rawDb = storage.getDb();
      if (snap) {
        rawDb.prepare(
          "INSERT INTO readiness_snapshots (fetched_at, source, payload_json, summary) VALUES (?, ?, ?, ?)"
        ).run(new Date().toISOString(), "kalodata_readiness", JSON.stringify(snap), snap.summary || "");
      }
      const latest = rawDb.prepare("SELECT * FROM readiness_snapshots ORDER BY id DESC LIMIT 1").get();
      res.json(latest || { completion_pct: 0, total_items: 0 });
    } catch (e) {
      res.json({ completion_pct: 0, total_items: 0, error: "companion site unavailable" });
    }
  });

  // ============ Dynamic roadmap ============
  // Merges the hardcoded baseline phases with the live draft_tasks state
  // so the roadmap auto-reflects merged-PR progress without manual edits.
  app.get("/api/roadmap/dynamic", (_req, res) => {
    const drafts = storage.listDraftTasks({ limit: 500 });
    // Group drafts by area into ad-hoc "phases" (one phase per area).
    const byArea = new Map<string, any[]>();
    for (const d of drafts) {
      const a = (d as any).area || "general";
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a)!.push(d);
    }
    const phases: any[] = [];
    for (const [area, items] of Array.from(byArea.entries())) {
      const shipped = items.filter((i: any) => i.status === "shipped").length;
      const total = items.length;
      const pct = total ? Math.round((shipped / total) * 100) : 0;
      phases.push({
        id: `area-${area}`,
        name: `${area.toUpperCase()} — ${shipped}/${total} shipped (${pct}%)`,
        description: `Live roadmap slice for area:${area}, auto-derived from explorer drafts + reconciled GitHub state.`,
        progress_pct: pct,
        items: items.slice(0, 50).map((i: any) => ({
          id: (i as any).gh_issue_number ? `${(i as any).gh_repo}#${(i as any).gh_issue_number}` : `local-${i.id}`,
          title: i.title,
          status: i.status,
          priority: i.priority,
          repo: (i as any).gh_repo || (i.repo_url || "").replace("https://github.com/", ""),
          issue: (i as any).gh_issue_number,
          url: (i as any).gh_issue_url,
        })),
      });
    }
    phases.sort((a, b) => (a.progress_pct - b.progress_pct));
    res.json({
      phases,
      totals: {
        drafts_total: drafts.length,
        drafts_shipped: drafts.filter((d) => d.status === "shipped").length,
        drafts_in_flight: drafts.filter((d) => d.status === "in_flight" || d.status === "queued").length,
        drafts_proposed: drafts.filter((d) => d.status === "proposed").length,
      },
    });
  });

  // ============ Autonomy dashboard endpoints ============

  // GET /api/autonomy/timeline — merged ExplorerRun + FleetRun list, desc by started_at, last 50
  app.get("/api/autonomy/timeline", (_req, res) => {
    const explorerRuns = storage.listRuns(50).map((r) => ({
      id: `explorer-${r.id}`,
      kind: "explorer" as const,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at ?? null,
      duration_ms: r.duration_ms,
      lane: r.trigger,
      label: `Explorer #${r.id}`,
      error: r.error ?? null,
    }));
    const fleetRunsList = storage.listFleetRuns({ limit: 50 }).map((r) => ({
      id: `fleet-${r.id}`,
      kind: r.kind as string,
      status: r.status,
      started_at: r.started_at,
      finished_at: r.finished_at ?? null,
      duration_ms: r.duration_ms,
      lane: r.executor,
      label: `${r.kind === "executor_cron" ? "Executor" : "Ad-hoc"} #${r.id}`,
      error: r.error ?? null,
    }));
    const all = [...explorerRuns, ...fleetRunsList]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, 50);
    res.json(all);
  });

  // GET /api/autonomy/queue — drafts ranked by ev_score desc (uses priority order)
  app.get("/api/autonomy/queue", (_req, res) => {
    const PRIORITY_ORDER: Record<string, number> = { p0: 4, p1: 3, p2: 2, p3: 1 };
    const drafts = storage.listDraftTasks({ status: "proposed", limit: 200 });
    const ranked = drafts
      .map((d) => {
        const evScore = (d as any).ev_score ?? PRIORITY_ORDER[d.priority] ?? 0;
        return { ...d, ev_score: evScore };
      })
      .sort((a, b) => {
        const evDiff = (b as any).ev_score - (a as any).ev_score;
        if (evDiff !== 0) return evDiff;
        return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      })
      .slice(0, 15);
    res.json(ranked);
  });

  // GET /api/autonomy/recent-prs — last 10 merged PRs across the 3 configured repos (cached 60s)
  let recentPrsCache: { data: any[]; fetched_at: number } | null = null;
  app.get("/api/autonomy/recent-prs", async (_req, res) => {
    const now = Date.now();
    if (recentPrsCache && now - recentPrsCache.fetched_at < 60_000) {
      return void res.json({ prs: recentPrsCache.data, fetched_at: new Date(recentPrsCache.fetched_at).toISOString(), cached: true });
    }
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      return void res.status(400).json({ error: "GitHub token not configured" });
    }
    const repos = [
      cfg.default_gh_repo,
      cfg.frontend_gh_repo,
      cfg.hub_gh_repo,
    ].filter(Boolean);
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const allPrs: any[] = [];
    const errors: string[] = [];
    for (const repo of repos) {
      try {
        const params = new URLSearchParams({
          state: "closed",
          per_page: "20",
          sort: "updated",
          direction: "desc",
        });
        const r = await fetch(`https://api.github.com/repos/${repo}/pulls?${params}`, { headers });
        if (!r.ok) {
          errors.push(`${repo} ${r.status}`);
          continue;
        }
        const items = (await r.json()) as any[];
        for (const pr of items) {
          if (!pr.merged_at) continue; // only merged PRs
          allPrs.push({
            number: pr.number,
            title: pr.title,
            repo,
            merged_at: pr.merged_at,
            html_url: pr.html_url,
            author: pr.user?.login ?? null,
            labels: (pr.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean),
          });
        }
      } catch (err: any) {
        errors.push(`${repo}: ${err?.message ?? err}`);
      }
    }
    allPrs.sort((a, b) => b.merged_at.localeCompare(a.merged_at));
    const top10 = allPrs.slice(0, 10);
    recentPrsCache = { data: top10, fetched_at: now };
    res.json({ prs: top10, repos, errors, fetched_at: new Date().toISOString(), cached: false });
  });

  // ── Consolidation cron (5th lane) ─────────────────────────────────────────
  // POST /api/consolidation/dispatch-now — manual on-demand dispatch
  app.post("/api/consolidation/dispatch-now", async (_req, res) => {
    try {
      const result = await dispatchConsolidationToCC();
      if (!result.ok) {
        return void res.status(500).json({ error: result.error });
      }
      return void res.json({ ok: true, cc_task_id: result.cc_task_id, executor: result.executor });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── Backlog Organizer (6th lane) ─────────────────────────────────────────
  // POST /api/organizer/dispatch-now — manual on-demand dispatch
  app.post("/api/organizer/dispatch-now", async (req, res) => {
    try {
      const scope = (req.body?.scope as OrganizerScope) ?? { kind: "full_backlog" };
      const result = await dispatchOrganizerToCC(scope);
      if (!result.ok) {
        return void res.status(500).json({ error: result.error });
      }
      return void res.json({ ok: true, cc_task_id: result.cc_task_id, executor: result.executor });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // GET /api/organizer/state — current organizer config + last run + pause decision
  app.get("/api/organizer/state", (_req, res) => {
    try {
      const cfg = storage.getCronConfig() as any;
      const pauseDecision = computeExplorerPauseDecision();
      return void res.json({
        enabled: !!cfg.organizer_cron_enabled,
        interval_minutes: cfg.organizer_cron_interval_minutes ?? 30,
        last_run_at: cfg.organizer_last_run_at ?? null,
        last_stats: cfg.organizer_last_stats_json
          ? (() => { try { return JSON.parse(cfg.organizer_last_stats_json); } catch { return null; } })()
          : null,
        explorer_paused_reason: cfg.explorer_paused_reason ?? null,
        explorer_max_open_issues: cfg.explorer_max_open_issues ?? 1000,
        explorer_dynamic_pause_enabled: !!cfg.explorer_dynamic_pause_enabled,
        explorer_novelty_floor: cfg.explorer_novelty_floor ?? 2,
        pause_decision: pauseDecision,
      });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // ── Digest endpoint (AH-10X-05) ──────────────────────────────────────────
  // POST /api/digest/post — build the overnight digest markdown and optionally
  // post it to the configured Slack webhook.
  app.post("/api/digest/post", async (_req, res) => {
    try {
      const markdown = await buildDigestMarkdown();
      const cfg = storage.getCronConfig() as any;
      const webhookUrl: string | null = cfg.slack_webhook_url ?? null;

      let posted = false;
      if (webhookUrl) {
        try {
          const slackResp = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: markdown }),
          });
          posted = slackResp.ok;
        } catch (postErr: any) {
          // Log but don't fail the endpoint — caller still gets markdown
          console.error("[digest] Slack post error:", postErr?.message ?? postErr);
        }
      }

      return void res.json({ markdown, posted });
    } catch (err: any) {
      return void res.status(500).json({ error: err?.message ?? String(err) });
    }
  });

  // /api/actions.csv removed (SID action grid). Content-platform exports
  // are per-section endpoints under /api/content-platform/*.

  return httpServer;
}
