import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  explorerRuns, explorerFindings, learningLedger, draftTasks, cronConfig, fleetRuns, prOutcomes,
  type ExplorerRun, type InsertExplorerRun,
  type ExplorerFinding, type InsertExplorerFinding,
  type LearningLedgerEntry, type InsertLearningLedger,
  type DraftTask, type InsertDraftTask,
  type CronConfig,
  type FleetRun, type InsertFleetRun,
  type PrOutcome, type InsertPrOutcome,
} from "@shared/schema";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
export const db = drizzle(sqlite);

// Initialize tables on startup (idempotent CREATE TABLE IF NOT EXISTS)
function ensureSchema() {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS explorer_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'claude_opus_4_7',
      summary TEXT NOT NULL DEFAULT '',
      next_gameplan TEXT NOT NULL DEFAULT '',
      findings_count INTEGER NOT NULL DEFAULT 0,
      draft_tasks_count INTEGER NOT NULL DEFAULT 0,
      ledger_entries_count INTEGER NOT NULL DEFAULT 0,
      tokens_total INTEGER NOT NULL DEFAULT 0,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
    CREATE TABLE IF NOT EXISTS explorer_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      severity TEXT NOT NULL,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      action_name TEXT,
      phase_id TEXT,
      evidence_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open'
    );
    CREATE TABLE IF NOT EXISTS learning_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      heat REAL NOT NULL DEFAULT 1.0,
      seen_count INTEGER NOT NULL DEFAULT 1,
      pattern TEXT NOT NULL,
      context TEXT NOT NULL DEFAULT '',
      source_run_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS draft_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      project_slug TEXT NOT NULL,
      repo_url TEXT NOT NULL,
      priority TEXT NOT NULL,
      task_type TEXT NOT NULL DEFAULT 'dev_task',
      automatable INTEGER NOT NULL DEFAULT 1,
      relevant_skills_json TEXT NOT NULL DEFAULT '[]',
      effort_estimate TEXT NOT NULL,
      executor TEXT NOT NULL DEFAULT 'unassigned',
      agent_briefing TEXT NOT NULL,
      batch_id TEXT,
      cc_task_id INTEGER,
      cc_pr_url TEXT,
      shipped_at TEXT,
      gh_issue_number INTEGER,
      gh_repo TEXT,
      gh_issue_url TEXT,
      gh_synced_at TEXT,
      merged_into_id INTEGER,
      area TEXT
    );
    CREATE TABLE IF NOT EXISTS cron_config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enabled INTEGER NOT NULL DEFAULT 1,
      interval_minutes INTEGER NOT NULL DEFAULT 60,
      model TEXT NOT NULL DEFAULT 'claude_opus_4_7',
      max_ledger_entries INTEGER NOT NULL DEFAULT 50,
      max_prior_summaries INTEGER NOT NULL DEFAULT 15,
      last_run_at TEXT,
      next_due_at TEXT,
      cc_api_url TEXT NOT NULL DEFAULT 'https://command-center-api-production-96e2.up.railway.app',
      cc_api_key TEXT NOT NULL DEFAULT 'miq-cmd-center-2026',
      default_cc_project_slug TEXT NOT NULL DEFAULT 'momentiq-dna',
      auto_create_gh_issues INTEGER NOT NULL DEFAULT 0,
      default_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna',
      frontend_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna',
      hub_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna-hub',
      batch_same_area INTEGER NOT NULL DEFAULT 1,
      batch_min_siblings INTEGER NOT NULL DEFAULT 2
    );
  `);
  // Idempotent additive migrations for older DBs
  // explorer_runs
  const explorerCols = sqlite.prepare("PRAGMA table_info('explorer_runs')").all() as any[];
  const eHas = (col: string) => explorerCols.some((c) => c.name === col);
  if (!eHas("next_pickup")) sqlite.exec("ALTER TABLE explorer_runs ADD COLUMN next_pickup TEXT");
  if (!eHas("parent_run_id")) sqlite.exec("ALTER TABLE explorer_runs ADD COLUMN parent_run_id INTEGER");
  // draft_tasks
  const draftCols = sqlite.prepare("PRAGMA table_info('draft_tasks')").all() as any[];
  const has = (col: string) => draftCols.some((c) => c.name === col);
  if (!has("gh_issue_number")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN gh_issue_number INTEGER");
  if (!has("gh_repo")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN gh_repo TEXT");
  if (!has("gh_issue_url")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN gh_issue_url TEXT");
  if (!has("gh_synced_at")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN gh_synced_at TEXT");
  if (!has("merged_into_id")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN merged_into_id INTEGER");
  if (!has("area")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN area TEXT");
  if (!has("ev_score")) sqlite.exec("ALTER TABLE draft_tasks ADD COLUMN ev_score REAL DEFAULT 1.0");
  const cronCols = sqlite.prepare("PRAGMA table_info('cron_config')").all() as any[];
  const cHas = (col: string) => cronCols.some((c) => c.name === col);
  if (!cHas("auto_create_gh_issues")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_create_gh_issues INTEGER NOT NULL DEFAULT 0");
  if (!cHas("default_gh_repo")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN default_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna'");
  if (!cHas("frontend_gh_repo")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN frontend_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna'");
  if (!cHas("hub_gh_repo")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN hub_gh_repo TEXT NOT NULL DEFAULT 'bemomentiq/momentiq-dna-hub'");
  if (!cHas("batch_same_area")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN batch_same_area INTEGER NOT NULL DEFAULT 1");
  if (!cHas("batch_min_siblings")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN batch_min_siblings INTEGER NOT NULL DEFAULT 2");
  if (!cHas("github_token")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN github_token TEXT");
  if (!cHas("github_token_set_at")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN github_token_set_at TEXT");
  if (!cHas("github_token_last4")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN github_token_last4 TEXT");
  if (!cHas("airtable_api_key")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN airtable_api_key TEXT");
  if (!cHas("monday_api_key")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN monday_api_key TEXT");
  if (!cHas("google_drive_oauth")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN google_drive_oauth TEXT");
  if (!cHas("focus_mission")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN focus_mission TEXT");
  // Auto-resume (always-on) controls
  if (!cHas("auto_resume_explorer")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_explorer INTEGER NOT NULL DEFAULT 0");
  if (!cHas("auto_resume_executor")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_executor INTEGER NOT NULL DEFAULT 0");
  if (!cHas("auto_resume_max_concurrent")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_max_concurrent INTEGER NOT NULL DEFAULT 3");
  if (!cHas("auto_resume_min_gap_sec")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_min_gap_sec INTEGER NOT NULL DEFAULT 30");
  if (!cHas("mini5_fallback_enabled")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN mini5_fallback_enabled INTEGER NOT NULL DEFAULT 1");
  if (!cHas("stale_run_max_age_sec")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN stale_run_max_age_sec INTEGER NOT NULL DEFAULT 2400");
  // Slack webhook URL for daily digest (AH-10X-05)
  if (!cHas("slack_webhook_url")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN slack_webhook_url TEXT");
  // Per-kind concurrency caps + master loop toggle (AH-PHASE4-2)
  if (!cHas("autonomous_indefinite_loop")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN autonomous_indefinite_loop INTEGER NOT NULL DEFAULT 1");
  if (!cHas("auto_resume_explorer_max")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_explorer_max INTEGER NOT NULL DEFAULT 3");
  if (!cHas("auto_resume_executor_max")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_executor_max INTEGER NOT NULL DEFAULT 3");
  // Codebase audit agent (AH-10X-09)
  if (!cHas("auto_resume_audit")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_audit INTEGER NOT NULL DEFAULT 0");
  if (!cHas("auto_resume_audit_max")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_audit_max INTEGER NOT NULL DEFAULT 1");
  if (!cHas("audit_interval_hours")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN audit_interval_hours INTEGER NOT NULL DEFAULT 6");
  // DNA Hub 4-lane extensions (idempotent)
  if (!cHas("auto_resume_test_debug")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_test_debug INTEGER NOT NULL DEFAULT 1");
  if (!cHas("auto_resume_test_debug_max")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN auto_resume_test_debug_max INTEGER NOT NULL DEFAULT 1");
  if (!cHas("test_debug_interval_hours")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN test_debug_interval_hours INTEGER NOT NULL DEFAULT 4");
  if (!cHas("pr_babysitter_enabled")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN pr_babysitter_enabled INTEGER NOT NULL DEFAULT 1");
  if (!cHas("companion_site_url")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN companion_site_url TEXT NOT NULL DEFAULT 'https://kalodata-ai-content-platform-t.pplx.app'");
  if (!cHas("epic_mode")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN epic_mode INTEGER NOT NULL DEFAULT 1");
  if (!cHas("gh_webhook_secret")) sqlite.exec("ALTER TABLE cron_config ADD COLUMN gh_webhook_secret TEXT NOT NULL DEFAULT 'dev-bypass'");
  // Bump prior summaries default to 15 if still on legacy default
  sqlite.exec("UPDATE cron_config SET max_prior_summaries = 15 WHERE max_prior_summaries < 15");
  // Fleet runs (executor cron + ad-hoc)
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS fleet_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      executor TEXT NOT NULL DEFAULT 'pin-codex',
      fallback_executor TEXT,
      model TEXT NOT NULL DEFAULT 'gpt_5_5',
      priority TEXT NOT NULL DEFAULT 'p1',
      repo_url TEXT NOT NULL,
      cc_task_id INTEGER,
      cc_task_status TEXT,
      gh_issue_numbers_json TEXT NOT NULL DEFAULT '[]',
      gh_pr_url TEXT,
      gh_pr_state TEXT,
      user_prompt TEXT,
      agent_briefing TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      direct_marker TEXT,
      plan_markdown TEXT
    );
  `);
  // Migrate existing fleet_runs rows that may pre-date direct_marker / plan_markdown
  const fleetCols = sqlite.prepare("PRAGMA table_info('fleet_runs')").all() as any[];
  const fHas = (c: string) => fleetCols.some((x: any) => x.name === c);
  if (!fHas("direct_marker")) sqlite.exec("ALTER TABLE fleet_runs ADD COLUMN direct_marker TEXT");
  if (!fHas("plan_markdown")) sqlite.exec("ALTER TABLE fleet_runs ADD COLUMN plan_markdown TEXT");
  if (!fHas("next_pickup")) sqlite.exec("ALTER TABLE fleet_runs ADD COLUMN next_pickup TEXT");
  if (!fHas("parent_run_id")) sqlite.exec("ALTER TABLE fleet_runs ADD COLUMN parent_run_id INTEGER");
  // Backfill: migrate marker that was stored in error field
  sqlite.exec("UPDATE fleet_runs SET direct_marker = error, error = NULL WHERE error LIKE 'direct:agentId=%' AND direct_marker IS NULL");
  // PR Outcomes — additive migration
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pr_outcomes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      source_run_id INTEGER,
      gh_pr_url TEXT,
      outcome TEXT NOT NULL,
      ci_cycles INTEGER NOT NULL DEFAULT 0,
      reviewer_comments INTEGER NOT NULL DEFAULT 0,
      reward_delta REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);
  // New 4-lane DNA hub tables
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS pr_babysitter_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      repo TEXT NOT NULL,
      pr_number INTEGER NOT NULL,
      pr_url TEXT,
      action_taken TEXT,
      ci_status TEXT,
      fix_attempts INTEGER NOT NULL DEFAULT 0,
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS test_debug_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      trigger TEXT NOT NULL,
      surfaces_json TEXT NOT NULL DEFAULT '[]',
      findings_count INTEGER NOT NULL DEFAULT 0,
      filed_issue_numbers_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      error TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS skill_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      run_id INTEGER,
      run_kind TEXT,
      skill_name TEXT NOT NULL,
      diff_summary TEXT NOT NULL,
      patch TEXT,
      applied INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS readiness_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fetched_at TEXT NOT NULL,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT ''
    );
  `);
  // Seed singleton cron config row if missing
  const existing = sqlite.prepare("SELECT id FROM cron_config WHERE id=1").get();
  if (!existing) {
    sqlite.prepare(`
      INSERT INTO cron_config (id, enabled, interval_minutes, next_due_at)
      VALUES (1, 1, 60, datetime('now', '+60 minutes'))
    `).run();
  }
  // Seed focus_mission default for DNA hub if not set
  const focusRow = sqlite.prepare("SELECT focus_mission FROM cron_config WHERE id=1").get() as any;
  if (!focusRow?.focus_mission) {
    sqlite.prepare(
      "UPDATE cron_config SET focus_mission = ? WHERE id=1",
    ).run("Drive momentiq-dna repo to production-readiness per companion site signals. Prioritize Code Completeness > Test Coverage > E2E Flows > Schema Integrity. Epic mode enabled.");
  }
  // Seed GitHub PAT from environment if not already set in DB.
  // Set GH_TOKEN or GITHUB_TOKEN env var on Railway; configure via Settings → GitHub PAT at runtime.
  const envPat = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const tokenRow = sqlite.prepare("SELECT github_token FROM cron_config WHERE id=1").get() as any;
  if (!tokenRow?.github_token && envPat) {
    const last4 = envPat.slice(-4);
    sqlite.prepare(
      "UPDATE cron_config SET github_token = ?, github_token_set_at = ?, github_token_last4 = ? WHERE id=1",
    ).run(envPat, new Date().toISOString(), last4);
  }
}
ensureSchema();

// ====== EV scoring ======

/**
 * Compute the economic expected-value score for a single draft task.
 * ev_score = priority_weight × area_money_factor × P(merge_clean) / effort_hrs
 */
export function scoreDraftEV(d: DraftTask, pr_outcomes: PrOutcome[] = []): number {
  const priorityWeight = ({ p0: 4, p1: 3, p2: 2, p3: 1 } as Record<string, number>)[d.priority] ?? 2;
  const area = (d as any).area || "general";
  const moneyFactor = ({
    paid_ads: 3, live: 2.5, payment: 3, sample: 1.5, training: 2, eval: 1.5,
  } as Record<string, number>)[area] ?? 1;
  // P(merge_clean): avg from prior pr_outcomes if we have 3+ data points, else 0.7
  const relevantOutcomes = pr_outcomes.slice(0, 20);
  let pMerge = 0.7;
  if (relevantOutcomes.length >= 3) {
    const merged = relevantOutcomes.filter(o => o.outcome === "merged").length;
    pMerge = merged / relevantOutcomes.length;
  }
  // Parse effort_estimate "X hrs" or "X-Y hrs"
  const effortMatch = (d.effort_estimate || "").match(/(\d+)/);
  const effortHrs = effortMatch ? parseInt(effortMatch[1], 10) : 4;
  return priorityWeight * moneyFactor * pMerge / Math.max(0.5, effortHrs);
}

/**
 * Recompute ev_score for every draft task in the database.
 * Called on boot and every 1 hour so scores stay fresh as pr_outcomes data arrives.
 */
export function computeAllDraftEvs(): void {
  // If AH-10X-01 landed, we could pull pr_outcomes here. For now, use empty = 0.7 default.
  const prOutcomes: PrOutcome[] = [];
  const all = db.select().from(draftTasks).all();
  for (const d of all) {
    const score = scoreDraftEV(d, prOutcomes);
    db.update(draftTasks).set({ ev_score: score }).where(eq(draftTasks.id, d.id)).run();
  }
}

// Compute all EV scores on startup (handles existing rows)
computeAllDraftEvs();
// Recompute every hour so scores refresh when pr_outcomes data arrives from AH-10X-01
setInterval(computeAllDraftEvs, 60 * 60 * 1000);

// ====== Storage interface ======

export const storage = {
  // Cron config
  getCronConfig(): CronConfig {
    const row = db.select().from(cronConfig).where(eq(cronConfig.id, 1)).get();
    if (!row) throw new Error("cron_config singleton missing");
    return row;
  },
  // Safe-for-response version (never leaks plaintext credentials)
  getCronConfigSafe(): any {
    const row = this.getCronConfig();
    const { github_token, airtable_api_key, monday_api_key, google_drive_oauth, slack_webhook_url, ...rest } = row as any;
    return {
      ...rest,
      has_github_token: !!github_token,
      has_airtable_key: !!airtable_api_key,
      has_monday_key: !!monday_api_key,
      has_drive_oauth: !!google_drive_oauth,
      has_slack_webhook: !!slack_webhook_url,
      // Surface whether Neon read URL is configured (read from env; never stored in DB)
      has_neon_read_url: !!process.env.NEON_READ_URL,
    };
  },
  // Set Slack webhook URL (AH-10X-05)
  setSlackWebhookUrl(url: string | null) {
    const trimmed = url ? url.trim() : null;
    db.update(cronConfig).set({ slack_webhook_url: trimmed } as any).where(eq(cronConfig.id, 1)).run();
    return this.getCronConfigSafe();
  },
  // Set GitHub PAT and capture last4 + saved-at metadata for UI display
  setGithubToken(token: string) {
    const trimmed = (token ?? "").trim();
    const last4 = trimmed.length >= 4 ? trimmed.slice(-4) : trimmed;
    db.update(cronConfig).set({
      github_token: trimmed || null,
      github_token_set_at: trimmed ? new Date().toISOString() : null,
      github_token_last4: trimmed ? last4 : null,
    } as any).where(eq(cronConfig.id, 1)).run();
    return this.getCronConfigSafe();
  },
  updateCronConfig(updates: Partial<CronConfig>) {
    db.update(cronConfig).set(updates).where(eq(cronConfig.id, 1)).run();
    return this.getCronConfig();
  },

  // Runs
  createRun(input: InsertExplorerRun): ExplorerRun {
    return db.insert(explorerRuns).values(input).returning().get();
  },
  updateRun(id: number, updates: Partial<ExplorerRun>): ExplorerRun | undefined {
    db.update(explorerRuns).set(updates).where(eq(explorerRuns.id, id)).run();
    return db.select().from(explorerRuns).where(eq(explorerRuns.id, id)).get();
  },
  getRun(id: number): ExplorerRun | undefined {
    return db.select().from(explorerRuns).where(eq(explorerRuns.id, id)).get();
  },
  listRuns(limit = 50): ExplorerRun[] {
    return db.select().from(explorerRuns).orderBy(desc(explorerRuns.id)).limit(limit).all();
  },
  // Bounded prior context: only the latest N completed run summaries.
  // Anything older than `limit` is auto-compacted into the ledger via compactStaleExplorerSummaries() below.
  priorRunSummaries(limit = 15): { id: number; started_at: string; summary: string; next_gameplan: string; next_pickup: string | null }[] {
    return db.select({
      id: explorerRuns.id,
      started_at: explorerRuns.started_at,
      summary: explorerRuns.summary,
      next_gameplan: explorerRuns.next_gameplan,
      next_pickup: explorerRuns.next_pickup,
    }).from(explorerRuns)
      .where(eq(explorerRuns.status, "completed"))
      .orderBy(desc(explorerRuns.id))
      .limit(limit).all();
  },
  // Pruning helper: any completed run beyond the most-recent `keep` is compacted.
  // We don't delete the row — we just blank out the long fields so prompts that ever
  // accidentally over-read can't blow context. Returns count compacted.
  // Compact stale explorer run summaries. Keeps the most recent `keep` verbose,
  // trims the rest to a [compacted] stub. Idempotent. Mirrors compactStaleSummaries
  // but also compacts next_pickup so context stays bounded.
  compactStaleExplorerSummaries(keep = 15): number {
    const all = db.select({ id: explorerRuns.id, summary: explorerRuns.summary })
      .from(explorerRuns)
      .where(eq(explorerRuns.status, "completed"))
      .orderBy(desc(explorerRuns.id))
      .all();
    if (all.length <= keep) return 0;
    const stale = all.slice(keep);
    let compacted = 0;
    for (const row of stale) {
      if ((row.summary || "").startsWith("[compacted]")) continue;
      const trimmed = `[compacted] ${(row.summary || "").slice(0, 120)}`;
      db.update(explorerRuns)
        .set({ summary: trimmed, next_gameplan: "[compacted]", next_pickup: "[compacted]" } as any)
        .where(eq(explorerRuns.id, row.id))
        .run();
      compacted++;
    }
    return compacted;
  },
  // Compact stale fleet (executor) run summaries. Keeps the most recent `keep` verbose,
  // trims the rest to a [compacted] header. Idempotent.
  compactStaleFleetSummaries(kind: string, keep = 25): number {
    const rows = db.select({ id: fleetRuns.id, summary: fleetRuns.summary, plan_markdown: fleetRuns.plan_markdown, next_pickup: fleetRuns.next_pickup })
      .from(fleetRuns)
      .where(eq(fleetRuns.kind, kind))
      .orderBy(desc(fleetRuns.id))
      .all() as any[];
    if (rows.length <= keep) return 0;
    const stale = rows.slice(keep);
    let compacted = 0;
    for (const row of stale) {
      if ((row.summary || "").startsWith("[compacted]")) continue;
      const trimmed = `[compacted] ${(row.summary || "").slice(0, 120)}`;
      db.update(fleetRuns).set({ summary: trimmed, plan_markdown: "[compacted]", next_pickup: "[compacted]" } as any)
        .where(eq(fleetRuns.id, row.id)).run();
      compacted++;
    }
    return compacted;
  },
  compactStaleSummaries(keep = 15): number {
    const all = db.select({ id: explorerRuns.id, summary: explorerRuns.summary })
      .from(explorerRuns)
      .where(eq(explorerRuns.status, "completed"))
      .orderBy(desc(explorerRuns.id))
      .all();
    if (all.length <= keep) return 0;
    const stale = all.slice(keep);
    let compacted = 0;
    for (const row of stale) {
      // Idempotent: skip rows we've already compacted (marker prefix)
      if ((row.summary || "").startsWith("[compacted]")) continue;
      const trimmed = `[compacted] ${(row.summary || "").slice(0, 120)}`;
      db.update(explorerRuns).set({ summary: trimmed, next_gameplan: "[compacted]" })
        .where(eq(explorerRuns.id, row.id)).run();
      compacted++;
    }
    return compacted;
  },

  // Findings
  createFinding(input: InsertExplorerFinding): ExplorerFinding {
    return db.insert(explorerFindings).values(input).returning().get();
  },
  listFindings(filter?: { status?: string; action_name?: string; run_id?: number; limit?: number }): ExplorerFinding[] {
    const conds = [] as any[];
    if (filter?.status) conds.push(eq(explorerFindings.status, filter.status));
    if (filter?.action_name) conds.push(eq(explorerFindings.action_name, filter.action_name));
    if (filter?.run_id) conds.push(eq(explorerFindings.run_id, filter.run_id));
    let q = db.select().from(explorerFindings) as any;
    if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
    return q.orderBy(desc(explorerFindings.id)).limit(filter?.limit ?? 200).all();
  },
  updateFinding(id: number, updates: Partial<ExplorerFinding>): ExplorerFinding | undefined {
    db.update(explorerFindings).set(updates).where(eq(explorerFindings.id, id)).run();
    return db.select().from(explorerFindings).where(eq(explorerFindings.id, id)).get();
  },

  // Ledger
  createLedger(input: InsertLearningLedger): LearningLedgerEntry {
    return db.insert(learningLedger).values(input).returning().get();
  },
  // De-dup: if pattern already exists (case-insensitive substring), bump heat instead of inserting
  upsertLedger(pattern: string, context: string, source_run_id: number): LearningLedgerEntry {
    const existing = db.select().from(learningLedger)
      .where(sql`lower(${learningLedger.pattern}) = lower(${pattern})`)
      .get();
    const now = new Date().toISOString();
    if (existing) {
      const newHeat = Math.min(10, existing.heat + 0.5);
      db.update(learningLedger)
        .set({ heat: newHeat, last_seen_at: now, seen_count: existing.seen_count + 1, source_run_id })
        .where(eq(learningLedger.id, existing.id))
        .run();
      return db.select().from(learningLedger).where(eq(learningLedger.id, existing.id)).get()!;
    }
    return this.createLedger({
      created_at: now, last_seen_at: now, pattern, context, source_run_id,
      heat: 1.0, seen_count: 1,
    });
  },
  listLedger(limit = 50): LearningLedgerEntry[] {
    return db.select().from(learningLedger).orderBy(desc(learningLedger.heat)).limit(limit).all();
  },
  // Heat decay + prune (called at end of every run)
  decayAndPrune(maxRows = 50) {
    db.update(learningLedger).set({ heat: sql`${learningLedger.heat} * 0.92` }).run();
    const rows = db.select().from(learningLedger).orderBy(desc(learningLedger.heat)).all();
    if (rows.length > maxRows) {
      const ids = rows.slice(maxRows).map((r) => r.id);
      for (const id of ids) {
        db.delete(learningLedger).where(eq(learningLedger.id, id)).run();
      }
    }
  },

  // Draft tasks
  createDraftTask(input: InsertDraftTask): DraftTask {
    const draft = db.insert(draftTasks).values(input).returning().get();
    // Compute and persist EV score immediately after insert
    const score = scoreDraftEV(draft);
    db.update(draftTasks).set({ ev_score: score }).where(eq(draftTasks.id, draft.id)).run();
    return db.select().from(draftTasks).where(eq(draftTasks.id, draft.id)).get()!;
  },
  listDraftTasks(filter?: { status?: string; batch_id?: string; limit?: number }): DraftTask[] {
    const conds = [] as any[];
    if (filter?.status) conds.push(eq(draftTasks.status, filter.status));
    if (filter?.batch_id) conds.push(eq(draftTasks.batch_id, filter.batch_id));
    let q = db.select().from(draftTasks) as any;
    if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
    return q.orderBy(desc(draftTasks.id)).limit(filter?.limit ?? 200).all();
  },
  getDraftTask(id: number): DraftTask | undefined {
    return db.select().from(draftTasks).where(eq(draftTasks.id, id)).get();
  },
  updateDraftTask(id: number, updates: Partial<DraftTask>): DraftTask | undefined {
    db.update(draftTasks).set(updates).where(eq(draftTasks.id, id)).run();
    const updated = db.select().from(draftTasks).where(eq(draftTasks.id, id)).get();
    // Recompute EV score when priority, area, or effort changes
    if (updated && (updates.priority !== undefined || (updates as any).area !== undefined || updates.effort_estimate !== undefined)) {
      const score = scoreDraftEV(updated);
      db.update(draftTasks).set({ ev_score: score }).where(eq(draftTasks.id, id)).run();
      return db.select().from(draftTasks).where(eq(draftTasks.id, id)).get();
    }
    return updated;
  },

  // Fleet runs (executor + ad-hoc)
  createFleetRun(input: InsertFleetRun): FleetRun {
    return db.insert(fleetRuns).values(input).returning().get();
  },
  getFleetRun(id: number): FleetRun | undefined {
    return db.select().from(fleetRuns).where(eq(fleetRuns.id, id)).get();
  },
  listFleetRuns(filter?: { kind?: string; status?: string; limit?: number }): FleetRun[] {
    const conds: any[] = [];
    if (filter?.kind) conds.push(eq(fleetRuns.kind, filter.kind));
    if (filter?.status) conds.push(eq(fleetRuns.status, filter.status));
    let q = db.select().from(fleetRuns) as any;
    if (conds.length) q = q.where(conds.length === 1 ? conds[0] : and(...conds));
    return q.orderBy(desc(fleetRuns.id)).limit(filter?.limit ?? 50).all();
  },
  updateFleetRun(id: number, updates: Partial<FleetRun>): FleetRun | undefined {
    db.update(fleetRuns).set(updates as any).where(eq(fleetRuns.id, id)).run();
    return this.getFleetRun(id);
  },

  // Reaper helpers — mark runs that have been stuck in 'running' longer than maxAgeSec as failed.
  markStaleExplorerRunsFailed(maxAgeSec: number): { count: number; ids: number[] } {
    const cutoff = new Date(Date.now() - maxAgeSec * 1000).toISOString();
    const stale = db
      .select({ id: explorerRuns.id })
      .from(explorerRuns)
      .where(and(eq(explorerRuns.status, "running"), sql`started_at <= ${cutoff}`))
      .all();
    if (!stale.length) return { count: 0, ids: [] };
    const ids = stale.map((r) => r.id);
    const now = new Date().toISOString();
    const reaped_min = Math.round(maxAgeSec / 60);
    db.update(explorerRuns)
      .set({ status: "failed", finished_at: now, error: `reaped (${reaped_min}min)` })
      .where(sql`id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
      .run();
    return { count: ids.length, ids };
  },

  markStaleFleetRunsFailed(maxAgeSec: number): { count: number; ids: number[] } {
    const cutoff = new Date(Date.now() - maxAgeSec * 1000).toISOString();
    const stale = db
      .select({ id: fleetRuns.id })
      .from(fleetRuns)
      .where(and(eq(fleetRuns.status, "running"), sql`started_at <= ${cutoff}`))
      .all();
    if (!stale.length) return { count: 0, ids: [] };
    const ids = stale.map((r) => r.id);
    const now = new Date().toISOString();
    const reaped_min = Math.round(maxAgeSec / 60);
    db.update(fleetRuns)
      .set({ status: "failed", finished_at: now, error: `reaped (${reaped_min}min)` })
      .where(sql`id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
      .run();
    return { count: ids.length, ids };
  },

  // ============ PR Outcomes ============
  recordPrOutcome(input: InsertPrOutcome): PrOutcome {
    return db.insert(prOutcomes).values(input).returning().get();
  },

  listPrOutcomes(limit = 50): PrOutcome[] {
    return db.select().from(prOutcomes).orderBy(desc(prOutcomes.id)).limit(limit).all();
  },

  // Find all ledger entries sourced from a given fleet run (via source_run_id)
  // and bump their heat by delta (capped 0.1–10).
  bumpLedgerHeatForRun(run_id: number, delta: number): void {
    const entries = db.select().from(learningLedger)
      .where(eq(learningLedger.source_run_id, run_id))
      .all();
    for (const e of entries) {
      const newHeat = Math.max(0.1, Math.min(10, e.heat + delta));
      db.update(learningLedger)
        .set({ heat: newHeat })
        .where(eq(learningLedger.id, e.id))
        .run();
    }
  },

  // Aggregates
  stats() {
    const totalRuns = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).get()?.c ?? 0;
    const completed = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).where(eq(explorerRuns.status, "completed")).get()?.c ?? 0;
    const failed = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).where(eq(explorerRuns.status, "failed")).get()?.c ?? 0;
    const findingsOpen = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).where(eq(explorerFindings.status, "open")).get()?.c ?? 0;
    const draftsProposed = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(eq(draftTasks.status, "proposed")).get()?.c ?? 0;
    const draftsShipped = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(eq(draftTasks.status, "shipped")).get()?.c ?? 0;
    const ledgerCount = db.select({ c: sql<number>`count(*)` }).from(learningLedger).get()?.c ?? 0;
    return { totalRuns, completed, failed, findingsOpen, draftsProposed, draftsShipped, ledgerCount };
  },

  // Explorer-specific stats: counts that matter for an autonomous explorer agent.
  explorerStats() {
    const totalRuns = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).get()?.c ?? 0;
    const completed = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).where(eq(explorerRuns.status, "completed")).get()?.c ?? 0;
    const failed = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).where(eq(explorerRuns.status, "failed")).get()?.c ?? 0;

    // Total drafts across history
    const totalDrafts = db.select({ c: sql<number>`count(*)` }).from(draftTasks).get()?.c ?? 0;
    const ghIssuesFiled = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(sql`gh_issue_number IS NOT NULL`).get()?.c ?? 0;
    const ghIssuesShipped = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(eq(draftTasks.status, "shipped")).get()?.c ?? 0;

    // Findings by severity
    const findingsTotal = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).get()?.c ?? 0;
    const findingsOpen = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).where(eq(explorerFindings.status, "open")).get()?.c ?? 0;
    const findingsCritical = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).where(and(eq(explorerFindings.status, "open"), eq(explorerFindings.severity, "critical"))).get()?.c ?? 0;
    const findingsHigh = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).where(and(eq(explorerFindings.status, "open"), eq(explorerFindings.severity, "high"))).get()?.c ?? 0;

    // Distinct categories + areas
    const categoryRows = db.select({ c: explorerFindings.category }).from(explorerFindings).where(eq(explorerFindings.status, "open")).all();
    const categories = new Set(categoryRows.map((r) => r.c));
    const areaRows = db.select({ a: draftTasks.area }).from(draftTasks).where(sql`area IS NOT NULL AND status != 'superseded' AND status != 'dismissed'`).all();
    const areas = new Set(areaRows.map((r) => r.a).filter(Boolean));

    // Master trackers (batch_id startsWith 'ah-master-')
    const trackers = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(sql`batch_id LIKE 'ah-master-%'`).get()?.c ?? 0;

    // Distinct phases referenced in findings
    const phaseRows = db.select({ p: explorerFindings.phase_id }).from(explorerFindings).where(sql`phase_id IS NOT NULL`).all();
    const phases = new Set(phaseRows.map((r) => r.p).filter(Boolean));

    // Compounding learning telemetry
    const ledgerRows = db.select().from(learningLedger).all();
    const ledgerTotal = ledgerRows.length;
    const ledgerHotPatterns = ledgerRows.filter((l) => l.heat >= 1.5).length;
    const ledgerSeenSum = ledgerRows.reduce((s, l) => s + l.seen_count, 0);
    const avgLedgerHeat = ledgerTotal > 0 ? ledgerRows.reduce((s, l) => s + l.heat, 0) / ledgerTotal : 0;

    // Time-windowed run velocity (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const runs7d = db.select({ c: sql<number>`count(*)` }).from(explorerRuns).where(sql`started_at >= ${sevenDaysAgo}`).get()?.c ?? 0;
    const findings7d = db.select({ c: sql<number>`count(*)` }).from(explorerFindings).where(sql`created_at >= ${sevenDaysAgo}`).get()?.c ?? 0;
    const drafts7d = db.select({ c: sql<number>`count(*)` }).from(draftTasks).where(sql`created_at >= ${sevenDaysAgo}`).get()?.c ?? 0;

    return {
      runs: { total: totalRuns, completed, failed, last7d: runs7d },
      drafts: { total: totalDrafts, gh_issues_filed: ghIssuesFiled, shipped: ghIssuesShipped, last7d: drafts7d },
      findings: { total: findingsTotal, open: findingsOpen, critical_open: findingsCritical, high_open: findingsHigh, last7d: findings7d },
      groupings: { areas: areas.size, categories: categories.size, phases: phases.size, trackers },
      learning: { ledger_total: ledgerTotal, hot_patterns: ledgerHotPatterns, total_observations: ledgerSeenSum, avg_heat: avgLedgerHeat },
    };
  },

  // Expose raw SQLite handle for new-lane handlers that use direct SQL
  getDb() {
    return sqlite;
  },
};
