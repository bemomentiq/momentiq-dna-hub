import type { Express } from "express";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { ACTIONS, rollups } from "@shared/actions-seed";
import { getExtras, hitlHoursPerWeek } from "@shared/action-extras";
import { LIVE_FEED, OPEN_BLOCKERS } from "@shared/live-feed";
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
    const repos = [cfg.default_gh_repo, cfg.frontend_gh_repo].filter(Boolean);
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

  app.get("/api/actions", (_req, res) => {
    res.json(ACTIONS.map((a) => ({ ...a, extras: getExtras(a.action_name) })));
  });

  app.get("/api/actions/:name", (req, res) => {
    const action = ACTIONS.find((a) => a.action_name === req.params.name);
    if (!action) return void res.status(404).json({ error: "not found" });
    res.json({ ...action, extras: getExtras(action.action_name) });
  });

  app.get("/api/rollups", (_req, res) => {
    const r = rollups(ACTIONS);
    const hitl = hitlHoursPerWeek();
    const totalHumanHrs = hitl.reduce((s, x) => s + x.hours_per_week, 0);
    const promotableHrs = hitl.filter((x) => x.promotable).reduce((s, x) => s + x.hours_per_week, 0);
    res.json({ ...r, total_human_hours_per_week: totalHumanHrs, promotable_hours_per_week: promotableHrs });
  });

  app.get("/api/hitl-burden", (_req, res) => {
    res.json(hitlHoursPerWeek());
  });

  app.get("/api/feed", (_req, res) => {
    res.json({ recent: LIVE_FEED, blockers: OPEN_BLOCKERS });
  });

  app.get("/api/money-path", (_req, res) => {
    const moneyActions = ACTIONS.filter((a) => {
      const x = getExtras(a.action_name);
      return x.money_path;
    }).map((a) => ({ ...a, extras: getExtras(a.action_name) }));
    res.json(moneyActions);
  });

  app.get("/api/data-pipeline", (_req, res) => {
    // Aggregate sources with full chain metadata
    const sourceMap = new Map<string, { source: string; total_rows: number; actions: { name: string; display_name: string; rows: number; cleaning: string[] }[] }>();
    ACTIONS.forEach((a) => {
      a.data_sources.forEach((s) => {
        if (!sourceMap.has(s.source)) sourceMap.set(s.source, { source: s.source, total_rows: 0, actions: [] });
        const e = sourceMap.get(s.source)!;
        e.total_rows += s.estimated_rows;
        e.actions.push({ name: a.action_name, display_name: a.display_name, rows: s.estimated_rows, cleaning: s.cleaning_steps });
      });
    });
    const sources = Array.from(sourceMap.values()).sort((a, b) => b.total_rows - a.total_rows);

    // Pipeline funnel: source rows → cleaned → fixtures → training rows → eval cases
    const totalSourceRows = sources.reduce((s, x) => s + x.total_rows, 0);
    const totalTrainingRows = ACTIONS.reduce((s, a) => s + a.training_rows, 0);
    const totalFixtures = ACTIONS.reduce((s, a) => s + a.fixture_count, 0);
    const evalCases = ACTIONS.reduce((s, a) => s + a.eval_corpus_size, 0);

    res.json({
      sources,
      funnel: [
        { stage: "Source rows discovered", value: totalSourceRows },
        { stage: "Cleaned + labeled (training)", value: totalTrainingRows },
        { stage: "Backtest fixtures", value: totalFixtures },
        { stage: "Eval corpus (active)", value: evalCases },
      ],
    });
  });

  app.get("/api/roadmap", (_req, res) => {
    const phases = [
      { id: "phase-a", name: "Phase A — Production LLM wire-up", description: "Ship hybrid intent classifier to prod, AnthropicCompletionProvider DI, $50/day budget throttle. From FLEET tracker #3604.", items: [
        { id: "CLASSIFIER-WIRE-1", title: "Wire hybrid router into detect_and_route_intent", action: "detect_and_route_intent", status: "shipped", issue: 3605 },
        { id: "CLASSIFIER-WIRE-2", title: "AnthropicCompletionProvider DI + per-shop feature flag", action: "detect_and_route_intent", status: "shipped", issue: 3606 },
        { id: "CLASSIFIER-WIRE-3", title: "$50/day budget throttle + observation logging", action: "detect_and_route_intent", status: "shipped", issue: 3607 },
      ]},
      { id: "phase-b", name: "Phase B — 10 zero-fixture actions", description: "Each action gets ≥100 real backtest fixtures + outcome ladder + learning-engine scoring. All 10 shipped 2026-04-24.", items: [
        { id: "AUTONOMY-AUTO-APPROVE", action: "auto_approve_or_route_to_hitl", title: "Ship auto_approve_draft with CARE score gate + 100 real fixtures", status: "shipped", issue: 3608 },
        { id: "AUTONOMY-CLASSIFY-CREATOR", action: "evaluate_creator_eligibility", title: "Augment classify_creator with dormancy archetype + 100 real fixtures", status: "shipped", issue: 3609 },
        { id: "AUTONOMY-CLASSIFY-BY-GMV", action: "score_and_select_creators", title: "Extract findTierByGmv pure function + register as LIVE action", status: "shipped", issue: 3610 },
        { id: "AUTONOMY-FIND-TIER-BY-GMV", action: "score_and_select_creators", title: "Implement find_tier_by_gmv handler", status: "shipped", issue: 3611 },
        { id: "AUTONOMY-CLASSIFY-DORMANCY", action: "evaluate_reactivation_eligibility", title: "Register classifyDormancy as automation action + 100 real fixtures", status: "shipped", issue: 3612 },
        { id: "AUTONOMY-DETECT-INTENT", action: "detect_and_route_intent", title: "Replace legacy keyword matching with hybrid v5 classifier", status: "shipped", issue: 3613 },
        { id: "AUTONOMY-DISCOVER-CREATORS", action: "discover_creators", title: "Add outcome ladder + 100 fixtures + learning-engine scoring", status: "shipped", issue: 3614 },
        { id: "AUTONOMY-EVAL-ESCALATION", action: "escalate_to_manager", title: "Build evaluate_escalation handler with 5-rule composition", status: "shipped", issue: 3615 },
        { id: "AUTONOMY-EVAL-OFFER", action: "evaluate_offer_request", title: "Expand evaluate_organic_offer to 3-way decision + counter trigger", status: "shipped", issue: 3616 },
        { id: "AUTONOMY-COUNTER-OFFER", action: "evaluate_counter_offer", title: "Wire generate_counter_response to CARE response generator", status: "shipped", issue: 3617 },
      ]},
      { id: "phase-c", name: "Phase C — Outcome-based eval layer", description: "Per-action scorecards, 14-day outcome reward join, eval dashboard.", items: [
        { id: "EVAL-SCORECARD", title: "Per-action 3-metric scorecard dashboard", status: "shipped", issue: 3793 },
        { id: "EVAL-APPROVAL-RATE", title: "Join classifier output → AI Training feedback", status: "open" },
        { id: "EVAL-OUTCOME-REWARD", title: "14-day outcome join via ops_platform_outcomes", status: "open" },
        { id: "EVAL-DASHBOARD", title: "Per-action scorecard page (this hub)", status: "shipped" },
      ]},
      { id: "phase-d", name: "Phase D — Additional data sources", description: "Bring Gmail, Slack, Fireflies, TikTok events into the training corpus.", items: [
        { id: "DATA-GMAIL", title: "BD thread ingest (~3k threads)", status: "open" },
        { id: "DATA-SLACK", title: "#miq-ops + 37 brand channels ingest", status: "open" },
        { id: "DATA-FIREFLIES", title: "Sales + ops call transcript ingest", status: "open" },
        { id: "DATA-TTS-EVENTS", title: "TikTok Shop order/fulfillment event stream", status: "open" },
        { id: "DATA-PA-FEED", title: "Restore 6,452 missing PA records (blocks PD9/PD11/PD13)", status: "in_progress", issue: 3474 },
      ]},
      { id: "phase-e", name: "Phase E — Drift + auto-retrain", description: "Page-Hinkley drift, weekly retrain cron, ρ<0.80 auto-rollback.", items: [
        { id: "DRIFT-PAGE-HINKLEY", title: "Wire page-hinkley drift monitor", status: "open", issue: 3363 },
        { id: "RETRAIN-WEEKLY-CRON", title: "Activate weekly retrain cron", status: "open", issue: 3364 },
        { id: "AUTO-ROLLBACK", title: "ρ<0.80 → auto-revert trigger", status: "open" },
      ]},
      { id: "phase-f", name: "Phase F — HITL gate flips (highest leverage)", description: "Promote tina_review → auto on actions where eval pass ≥ 90% on a 200-case corpus.", items: ACTIONS.filter((a) => a.hitl_gate === "tina_review" && (a.eval_pass_pct ?? 0) >= 90).map((a) => ({ id: `FLIP-${a.action_name.toUpperCase()}`, action: a.action_name, title: `Promote ${a.display_name} from tina_review → auto`, status: "open" as const, issue: undefined as number | undefined })) },
      { id: "phase-g", name: "Phase G — Money-path L0 → L1 shadow", description: "Run all 5 money-path handlers in shadow mode for 30 days before considering promotion. ALEX kill-switch retained.", items: [
        "count_qualifying_posts", "verify_bundle_completion", "calculate_total_compensation", "process_fixed_rate_payment", "reconcile_payment",
      ].map((name) => ({ id: `SHADOW-${name.toUpperCase()}`, action: name, title: `30-day shadow eval for ${name}`, status: "open" as const, issue: undefined as number | undefined })) },
    ];
    res.json(phases);
  });

  // Markdown executive brief
  app.get("/api/exec-brief.md", (_req, res) => {
    const r = rollups(ACTIONS);
    const hitl = hitlHoursPerWeek();
    const promo = hitl.filter((x) => x.promotable).sort((a, b) => b.hours_per_week - a.hours_per_week);
    const promotableHrs = promo.reduce((s, x) => s + x.hours_per_week, 0);
    const trainPct = (r.total_training_rows / r.total_training_target) * 100;
    const lines: string[] = [];
    lines.push(`# SID Autonomy — Executive Brief`);
    lines.push(`_Snapshot 2026-04-29 · 40 canonical actions · 14 sampling + 26 paid_deal_`);
    lines.push("");
    lines.push(`## Topline`);
    lines.push(`- Production readiness (avg): **${r.avg_prod_readiness_pct.toFixed(0)}%**`);
    lines.push(`- Handlers wired: **${r.avg_handler_pct.toFixed(0)}%**`);
    lines.push(`- Training backfill: **${trainPct.toFixed(0)}%** (${r.total_training_rows.toLocaleString()} of ${r.total_training_target.toLocaleString()} rows)`);
    lines.push(`- Eval pass (avg): **${r.avg_eval_pass_pct.toFixed(0)}%** across ${r.total_fixtures.toLocaleString()} fixtures`);
    lines.push(`- Outcome-full evals: **${r.actions_outcome_full} / ${r.total_actions}** (${r.actions_no_evals} structural-only)`);
    lines.push(`- Estimated weekly HITL burden: **${hitl.reduce((s, x) => s + x.hours_per_week, 0).toFixed(0)} hrs/wk**`);
    lines.push(`- Recoverable via Phase F gate flips: **${promotableHrs.toFixed(0)} hrs/wk**`);
    lines.push("");
    lines.push(`## What shipped recently (last 9 days)`);
    LIVE_FEED.filter((f) => f.category === "autonomy" || f.category === "evals").slice(0, 8).forEach((f) => {
      lines.push(`- #${f.number} ${f.title}`);
    });
    lines.push("");
    lines.push(`## Top promotion candidates (Phase F)`);
    promo.slice(0, 8).forEach((x) => {
      lines.push(`- **${x.display_name}** — ${x.hours_per_week.toFixed(0)} hrs/wk recoverable, eval ${x.eval_pass_pct}%`);
    });
    lines.push("");
    lines.push(`## Open blockers`);
    OPEN_BLOCKERS.forEach((b) => lines.push(`- #${b.number} ${b.title}`));
    res.type("text/markdown").send(lines.join("\n"));
  });

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

  // CSV export of the full action grid
  app.get("/api/actions.csv", (_req, res) => {
    const rows = [
      ["action_name", "class", "#", "display_name", "hitl_gate", "autonomy_level", "handler_pct", "fixtures_pct", "fixture_count", "training_rows", "training_target", "training_backfill_pct", "eval_pass_pct", "eval_corpus_size", "eval_status", "prod_readiness_pct", "money_path", "weekly_runs_per_brand", "human_minutes_per_run"],
    ];
    ACTIONS.forEach((a) => {
      const x = getExtras(a.action_name);
      rows.push([
        a.action_name, a.class, String(a.action_number), a.display_name, a.hitl_gate, a.autonomy_level,
        String(a.handler_pct), String(a.fixtures_pct), String(a.fixture_count),
        String(a.training_rows), String(a.training_target), String(a.training_backfill_pct),
        String(a.eval_pass_pct ?? ""), String(a.eval_corpus_size), a.eval_status, String(a.prod_readiness_pct),
        String(x.money_path), String(x.weekly_runs_per_brand), String(x.human_minutes_per_run),
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    res.type("text/csv").send(csv);
  });

  return httpServer;
}
