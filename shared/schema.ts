import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============ Explorer runs ============
// Each row is one executed run of the self-learning explorer agent.
// Bounded context: we keep all rows but only load the latest 5 summaries into any new prompt.
export const explorerRuns = sqliteTable("explorer_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed'
  trigger: text("trigger").notNull(), // 'cron' | 'manual' | 'first_run'
  model: text("model").notNull().default("claude_opus_4_7"),
  // Compact <=2KB summary of what this run did, feeds future runs as prior-run context
  summary: text("summary").notNull().default(""),
  // Gameplan for the NEXT run (so next run picks up where this left off)
  next_gameplan: text("next_gameplan").notNull().default(""),
  // Fluid-chain pickup directive — written at END of every Explorer run (<500 chars),
  // injected into the NEXT run's prompt as the explicit chain handoff.
  next_pickup: text("next_pickup"),
  // Count of artifacts produced this run
  findings_count: integer("findings_count").notNull().default(0),
  draft_tasks_count: integer("draft_tasks_count").notNull().default(0),
  ledger_entries_count: integer("ledger_entries_count").notNull().default(0),
  // Raw tokens + duration for cost tracking
  tokens_total: integer("tokens_total").notNull().default(0),
  duration_ms: integer("duration_ms").notNull().default(0),
  error: text("error"),
  parent_run_id: integer("parent_run_id"),
});

export const insertExplorerRunSchema = createInsertSchema(explorerRuns).omit({ id: true });
export type ExplorerRun = typeof explorerRuns.$inferSelect;
export type InsertExplorerRun = z.infer<typeof insertExplorerRunSchema>;

// ============ Findings ============
// Bounded list of concrete observations about the codebase + roadmap.
// Each finding gets tagged to an action or a phase so the hub can surface it contextually.
export const explorerFindings = sqliteTable("explorer_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  run_id: integer("run_id").notNull(),
  created_at: text("created_at").notNull(),
  severity: text("severity").notNull(), // 'low' | 'medium' | 'high' | 'critical'
  category: text("category").notNull(), // 'gap_to_prod' | 'training_data' | 'eval' | 'drift' | 'optimization' | 'architecture' | 'risk'
  title: text("title").notNull(),
  body: text("body").notNull(),
  // Optional refs — join targets for the UI
  action_name: text("action_name"), // matches ACTIONS[].action_name
  phase_id: text("phase_id"), // e.g. 'phase-c'
  // Evidence: GitHub issue / PR numbers, file paths, commit SHAs
  evidence_json: text("evidence_json").notNull().default("[]"),
  // Dismissed / accepted by user
  status: text("status").notNull().default("open"), // 'open' | 'accepted' | 'dismissed' | 'superseded'
});

export const insertExplorerFindingSchema = createInsertSchema(explorerFindings).omit({ id: true });
export type ExplorerFinding = typeof explorerFindings.$inferSelect;
export type InsertExplorerFinding = z.infer<typeof insertExplorerFindingSchema>;

// ============ Learning ledger ============
// Durable, heat-scored patterns the agent has learned across runs.
// Kept small (<=50 rows) — when it overflows we prune lowest-heat entries.
export const learningLedger = sqliteTable("learning_ledger", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  created_at: text("created_at").notNull(),
  last_seen_at: text("last_seen_at").notNull(),
  heat: real("heat").notNull().default(1.0), // exponential-decay heat score
  seen_count: integer("seen_count").notNull().default(1),
  // Short (<=160 char) rule the agent distilled, e.g. "When evaluating money-path actions, always check 30-day shadow before promoting"
  pattern: text("pattern").notNull(),
  // Longer context giving the agent when to apply the rule
  context: text("context").notNull().default(""),
  source_run_id: integer("source_run_id"),
});

export const insertLearningLedgerSchema = createInsertSchema(learningLedger).omit({ id: true });
export type LearningLedgerEntry = typeof learningLedger.$inferSelect;
export type InsertLearningLedger = z.infer<typeof insertLearningLedgerSchema>;

// ============ Draft tasks ============
// Optimally-batched tasks proposed by the agent, ready for one-click ship to CC.
// Shape mirrors CC's POST /api/tasks/bulk schema so accept = direct POST.
export const draftTasks = sqliteTable("draft_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  run_id: integer("run_id").notNull(),
  created_at: text("created_at").notNull(),
  status: text("status").notNull().default("proposed"), // 'proposed' | 'accepted' | 'dismissed' | 'shipped'
  // CC-schema-compliant fields
  title: text("title").notNull(), // [PREFIX-N] summary ≤140 chars
  description: text("description").notNull(),
  project_slug: text("project_slug").notNull(), // e.g. 'momentiq-dna', 'cc-platform'
  repo_url: text("repo_url").notNull(),
  priority: text("priority").notNull(), // 'p0' | 'p1' | 'p2' | 'p3'
  task_type: text("task_type").notNull().default("dev_task"),
  automatable: integer("automatable", { mode: "boolean" }).notNull().default(true),
  relevant_skills_json: text("relevant_skills_json").notNull().default("[]"),
  effort_estimate: text("effort_estimate").notNull(),
  executor: text("executor").notNull().default("unassigned"),
  agent_briefing: text("agent_briefing").notNull(), // 8-H2 markdown body
  // Grouping: a batch of related draft tasks (sibling carving)
  batch_id: text("batch_id"),
  // CC output after ship
  cc_task_id: integer("cc_task_id"),
  cc_pr_url: text("cc_pr_url"),
  shipped_at: text("shipped_at"),
  // GitHub issue sync output
  gh_issue_number: integer("gh_issue_number"),
  gh_repo: text("gh_repo"), // e.g. 'bemomentiq/momentiq-dna'
  gh_issue_url: text("gh_issue_url"),
  gh_synced_at: text("gh_synced_at"),
  // Merge tracking: when this draft was merged into a larger batched task, point to the parent
  merged_into_id: integer("merged_into_id"),
  // Area-of-concern for batching (inferred by categorizer, e.g. 'evals', 'drift', 'money-path')
  area: text("area"),
  // Economic EV score: priority_weight × area_money_factor × P(merge_clean) / effort_hrs
  ev_score: real("ev_score").default(1.0),
});

export const insertDraftTaskSchema = createInsertSchema(draftTasks).omit({ id: true, cc_task_id: true, cc_pr_url: true, shipped_at: true });
export type DraftTask = typeof draftTasks.$inferSelect;
export type InsertDraftTask = z.infer<typeof insertDraftTaskSchema>;

// ============ Cron config (singleton) ============
export const cronConfig = sqliteTable("cron_config", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  interval_minutes: integer("interval_minutes").notNull().default(60),
  model: text("model").notNull().default("claude_opus_4_7"),
  max_ledger_entries: integer("max_ledger_entries").notNull().default(50),
  max_prior_summaries: integer("max_prior_summaries").notNull().default(15),
  last_run_at: text("last_run_at"),
  next_due_at: text("next_due_at"),
  cc_api_url: text("cc_api_url").notNull().default("https://command-center-api-production-96e2.up.railway.app"),
  cc_api_key: text("cc_api_key").notNull().default("miq-cmd-center-2026"),
  default_cc_project_slug: text("default_cc_project_slug").notNull().default("momentiq-dna"),
  // GitHub sync controls
  auto_create_gh_issues: integer("auto_create_gh_issues", { mode: "boolean" }).notNull().default(false), // skip HITL, auto-open issues on ingest
  default_gh_repo: text("default_gh_repo").notNull().default("bemomentiq/momentiq-dna"),
  frontend_gh_repo: text("frontend_gh_repo").notNull().default("bemomentiq/momentiq-dna"),
  // The Hub's own repo — target for self-improvement slices
  hub_gh_repo: text("hub_gh_repo").notNull().default("bemomentiq/momentiq-dna-hub"),
  // Batching knobs
  batch_same_area: integer("batch_same_area", { mode: "boolean" }).notNull().default(true),
  batch_min_siblings: integer("batch_min_siblings").notNull().default(2), // if >=N siblings in same area, merge
  github_token: text("github_token"), // PAT for issue creation; never returned in API responses
  github_token_set_at: text("github_token_set_at"), // ISO timestamp when PAT was last saved
  github_token_last4: text("github_token_last4"), // last 4 chars of the PAT for UI display
  // External data-source credentials for Explorer data-mapping missions (Airtable / Monday / Drive)
  airtable_api_key: text("airtable_api_key"),
  monday_api_key: text("monday_api_key"),
  google_drive_oauth: text("google_drive_oauth"), // base64-encoded JSON OAuth token
  // Live focus mission — swappable directive injected into every Explorer prompt
  focus_mission: text("focus_mission"),
  // Always-on auto-resume controls: dispatch new runs automatically as soon as a slot frees
  auto_resume_explorer: integer("auto_resume_explorer", { mode: "boolean" }).notNull().default(false),
  auto_resume_executor: integer("auto_resume_executor", { mode: "boolean" }).notNull().default(false),
  auto_resume_max_concurrent: integer("auto_resume_max_concurrent").notNull().default(3),
  auto_resume_min_gap_sec: integer("auto_resume_min_gap_sec").notNull().default(30),
  // Per-kind concurrency caps and master loop toggle (AH-PHASE4-2)
  autonomous_indefinite_loop: integer("autonomous_indefinite_loop", { mode: "boolean" }).notNull().default(true),
  auto_resume_explorer_max: integer("auto_resume_explorer_max").notNull().default(3),
  auto_resume_executor_max: integer("auto_resume_executor_max").notNull().default(3),
  // When both primary lanes for the configured Mini are down, cascade to mini-5 direct-tunnel
  mini5_fallback_enabled: integer("mini5_fallback_enabled", { mode: "boolean" }).notNull().default(true),
  // How long (seconds) a run may stay 'running' before the reaper marks it failed. Default 40 min.
  stale_run_max_age_sec: integer("stale_run_max_age_sec").notNull().default(2400),
  // Slack webhook URL for daily digest posts (AH-10X-05)
  slack_webhook_url: text("slack_webhook_url"),
  // Codebase audit agent (4th autonomous role — AH-10X-09)
  auto_resume_audit: integer("auto_resume_audit", { mode: "boolean" }).notNull().default(false),
  auto_resume_audit_max: integer("auto_resume_audit_max").notNull().default(1),
  audit_interval_hours: integer("audit_interval_hours").notNull().default(6),
  // DNA Hub 4-lane extensions
  auto_resume_test_debug: integer("auto_resume_test_debug", { mode: "boolean" }).notNull().default(true),
  auto_resume_test_debug_max: integer("auto_resume_test_debug_max").notNull().default(1),
  test_debug_interval_hours: integer("test_debug_interval_hours").notNull().default(4),
  pr_babysitter_enabled: integer("pr_babysitter_enabled", { mode: "boolean" }).notNull().default(true),
  companion_site_url: text("companion_site_url").notNull().default("https://kalodata-ai-content-platform-t.pplx.app"),
  epic_mode: integer("epic_mode", { mode: "boolean" }).notNull().default(true),
  gh_webhook_secret: text("gh_webhook_secret").notNull().default("dev-bypass"),
  // Consolidation cron lane (5th lane — CC-dispatched hourly DNA issue consolidation)
  consolidation_cron_enabled: integer("consolidation_cron_enabled", { mode: "boolean" }).notNull().default(true),
  consolidation_cron_interval_hours: integer("consolidation_cron_interval_hours").notNull().default(1),
  consolidation_briefing_gist: text("consolidation_briefing_gist").notNull().default("https://gist.githubusercontent.com/Alexelsea/5fd8d54e9abed9b47aebf44fd09137b5/raw/db802ac8eb8ae4fe9f5c09f6c727eb970f00bd0d/briefing.md"),
  consolidation_last_run_at: text("consolidation_last_run_at"),
  consolidation_last_cc_task_id: integer("consolidation_last_cc_task_id"),
  consolidation_last_mini_idx: integer("consolidation_last_mini_idx").notNull().default(0),
});

export const insertCronConfigSchema = createInsertSchema(cronConfig).omit({ id: true });
export type CronConfig = typeof cronConfig.$inferSelect;
export type InsertCronConfig = z.infer<typeof insertCronConfigSchema>;

// ============ Executor + Ad-hoc runs ============
// Unified table tracking every fleet dispatch the Hub initiates that ISN'T an Explorer run.
// kind = 'executor_cron' (recurring issue executor) | 'ad_hoc' (user clicked Run from /run page) | 'audit_cron' (codebase audit agent)
export const fleetRuns = sqliteTable("fleet_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // 'executor_cron' | 'ad_hoc'
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  trigger: text("trigger").notNull(),
  // Dispatch metadata
  executor: text("executor").notNull().default("pin-codex"), // 'pin-codex' | 'pin-claude' | 'unassigned'
  fallback_executor: text("fallback_executor"),
  model: text("model").notNull().default("gpt_5_5"),
  priority: text("priority").notNull().default("p1"),
  // Target repo
  repo_url: text("repo_url").notNull(),
  // CC linkage
  cc_task_id: integer("cc_task_id"),
  cc_task_status: text("cc_task_status"),
  // GitHub linkage
  gh_issue_numbers_json: text("gh_issue_numbers_json").notNull().default("[]"), // [num,num] for issues this run is executing
  gh_pr_url: text("gh_pr_url"),
  gh_pr_state: text("gh_pr_state"), // 'open' | 'merged' | 'closed' | null
  // User-supplied (ad_hoc) prompt or executor-cron focus
  user_prompt: text("user_prompt"),
  agent_briefing: text("agent_briefing").notNull(),
  // Output summary from the lane
  summary: text("summary").notNull().default(""),
  error: text("error"),
  duration_ms: integer("duration_ms").notNull().default(0),
  // Direct-dispatch marker: 'agentId=mini-5;pid=12345;workdir=...' for SSH-spawned runs
  direct_marker: text("direct_marker"),
  // Phase-0 plan committed by executor lane before transitioning to execution mode
  plan_markdown: text("plan_markdown"),
  // Pickup directive — written at the END of every executor run so the NEXT run knows where to pick up
  // (which issue was next on the plan but unstarted, what the previous run learned about the codebase, what to avoid)
  next_pickup: text("next_pickup"),
  // Replay linkage: if this run was created by replaying a prior failed/cancelled run, link to the original.
  parent_run_id: integer("parent_run_id"),
});

export const insertFleetRunSchema = createInsertSchema(fleetRuns).omit({ id: true });
export type FleetRun = typeof fleetRuns.$inferSelect;
export type InsertFleetRun = z.infer<typeof insertFleetRunSchema>;

// ============ PR Outcomes ============
// Records the outcome of every Executor fleet run's PR lifecycle.
// Drives the compounding-learning loop: merged PRs bump ledger heat,
// repeated CI failures penalize, and reverts apply the heaviest penalty.
export const prOutcomes = sqliteTable("pr_outcomes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  run_id: integer("run_id").notNull(),          // fleet_runs.id of the executor run
  source_run_id: integer("source_run_id"),       // explorer_runs.id that generated the originating finding
  gh_pr_url: text("gh_pr_url"),
  outcome: text("outcome").notNull(),            // 'merged' | 'failed' | 'reverted'
  ci_cycles: integer("ci_cycles").notNull().default(0),
  reviewer_comments: integer("reviewer_comments").notNull().default(0),
  reward_delta: real("reward_delta").notNull().default(0),
  created_at: text("created_at").notNull(),
});

export const insertPrOutcomeSchema = createInsertSchema(prOutcomes).omit({ id: true });
export type PrOutcome = typeof prOutcomes.$inferSelect;
export type InsertPrOutcome = z.infer<typeof insertPrOutcomeSchema>;

// ============ PR Babysitter runs ============
// Each row is one triggered run of the PR-Babysitter lane.
// Triggered via HMAC-verified webhook from GitHub CI events.
export const prBabysitterRuns = sqliteTable("pr_babysitter_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  trigger: text("trigger").notNull(), // 'webhook' | 'manual'
  repo: text("repo").notNull(), // e.g. 'bemomentiq/momentiq-dna'
  pr_number: integer("pr_number").notNull(),
  pr_url: text("pr_url"),
  // What the babysitter did: 'rebased' | 'force_pushed' | 'merged' | 'commented' | 'noop'
  action_taken: text("action_taken"),
  ci_status: text("ci_status"), // 'success' | 'failure' | 'pending'
  fix_attempts: integer("fix_attempts").notNull().default(0),
  summary: text("summary").notNull().default(""),
  error: text("error"),
  duration_ms: integer("duration_ms").notNull().default(0),
});
export const insertPrBabysitterRunSchema = createInsertSchema(prBabysitterRuns).omit({ id: true });
export type PrBabysitterRun = typeof prBabysitterRuns.$inferSelect;
export type InsertPrBabysitterRun = z.infer<typeof insertPrBabysitterRunSchema>;

// ============ Test Debug runs ============
// E2E probes run every 4 hours against deployed surfaces.
export const testDebugRuns = sqliteTable("test_debug_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  started_at: text("started_at").notNull(),
  finished_at: text("finished_at"),
  status: text("status").notNull(), // 'queued' | 'running' | 'completed' | 'failed'
  trigger: text("trigger").notNull(), // 'cron' | 'manual'
  // Surfaces tested: comma-separated list e.g. 'control-panel,pipeline,hub'
  surfaces_json: text("surfaces_json").notNull().default("[]"),
  findings_count: integer("findings_count").notNull().default(0),
  // GitHub issues auto-filed from this run
  filed_issue_numbers_json: text("filed_issue_numbers_json").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  error: text("error"),
  duration_ms: integer("duration_ms").notNull().default(0),
});
export const insertTestDebugRunSchema = createInsertSchema(testDebugRuns).omit({ id: true });
export type TestDebugRun = typeof testDebugRuns.$inferSelect;
export type InsertTestDebugRun = z.infer<typeof insertTestDebugRunSchema>;

// ============ Skill updates ============
// Agents POST discovered skill diffs here during Phase 5b of each run.
export const skillUpdates = sqliteTable("skill_updates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  created_at: text("created_at").notNull(),
  run_id: integer("run_id"),
  run_kind: text("run_kind"), // 'explorer' | 'executor' | 'pr_babysitter' | 'test_debug'
  skill_name: text("skill_name").notNull(),
  // What was learned: a short (<=512 char) diff/pattern
  diff_summary: text("diff_summary").notNull(),
  // Optional: raw file patch or code snippet
  patch: text("patch"),
  applied: integer("applied", { mode: "boolean" }).notNull().default(false),
});
export const insertSkillUpdateSchema = createInsertSchema(skillUpdates).omit({ id: true });
export type SkillUpdate = typeof skillUpdates.$inferSelect;
export type InsertSkillUpdate = z.infer<typeof insertSkillUpdateSchema>;

// ============ Readiness snapshots ============
// Periodic snapshots from the Kalodata companion API (/api/readiness, /api/roadmap-state).
// Injected into Explorer context to inform prioritization.
export const readinessSnapshots = sqliteTable("readiness_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fetched_at: text("fetched_at").notNull(),
  source: text("source").notNull(), // 'kalodata_readiness' | 'kalodata_roadmap'
  // Raw JSON payload from the companion API
  payload_json: text("payload_json").notNull(),
  // Distilled summary (<=1KB) for Explorer injection
  summary: text("summary").notNull().default(""),
});
export const insertReadinessSnapshotSchema = createInsertSchema(readinessSnapshots).omit({ id: true });
export type ReadinessSnapshot = typeof readinessSnapshots.$inferSelect;
export type InsertReadinessSnapshot = z.infer<typeof insertReadinessSnapshotSchema>;
