export type ExplorerRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "queued" | "running" | "completed" | "failed";
  trigger: string;
  model: string;
  summary: string;
  next_gameplan: string;
  findings_count: number;
  draft_tasks_count: number;
  ledger_entries_count: number;
  tokens_total: number;
  duration_ms: number;
  error: string | null;
};

export type ExplorerFinding = {
  id: number;
  run_id: number;
  created_at: string;
  severity: "low" | "medium" | "high" | "critical";
  category: "gap_to_prod" | "training_data" | "eval" | "drift" | "optimization" | "architecture" | "risk";
  title: string;
  body: string;
  action_name: string | null;
  phase_id: string | null;
  // DNA roadmap focus_area id (one of shared/dna-focus-areas.ts FOCUS_AREA_IDS).
  // Null on legacy rows; surfaces as "(uncategorized)" in the Explorer rail.
  focus_area: string | null;
  evidence_json: string;
  status: "open" | "accepted" | "dismissed" | "superseded";
};

export type LedgerEntry = {
  id: number;
  created_at: string;
  last_seen_at: string;
  heat: number;
  seen_count: number;
  pattern: string;
  context: string;
  source_run_id: number | null;
};

export type DraftTask = {
  id: number;
  run_id: number;
  created_at: string;
  status: "proposed" | "accepted" | "dismissed" | "shipped";
  title: string;
  description: string;
  project_slug: string;
  repo_url: string;
  priority: "p0" | "p1" | "p2" | "p3";
  task_type: string;
  automatable: boolean;
  relevant_skills_json: string;
  effort_estimate: string;
  executor: string;
  agent_briefing: string;
  batch_id: string | null;
  cc_task_id: number | null;
  cc_pr_url: string | null;
  shipped_at: string | null;
  gh_issue_number: number | null;
  gh_repo: string | null;
  gh_issue_url: string | null;
  gh_synced_at: string | null;
  merged_into_id: number | null;
  area: string | null;
};

export type CronConfig = {
  id: number;
  enabled: boolean;
  interval_minutes: number;
  model: string;
  max_ledger_entries: number;
  max_prior_summaries: number;
  last_run_at: string | null;
  next_due_at: string | null;
  cc_api_url: string;
  cc_api_key: string;
  default_cc_project_slug: string;
  auto_create_gh_issues: boolean;
  default_gh_repo: string;
  frontend_gh_repo: string;
  batch_same_area: boolean;
  batch_min_siblings: number;
  has_github_token: boolean;
  github_token_set_at: string | null;
  github_token_last4: string | null;
  // Newer cron-config fields surfaced by getCronConfigSafe()
  focus_mission?: string | null;
  auto_resume_explorer?: boolean;
  auto_resume_executor?: boolean;
  auto_resume_max_concurrent?: number;
  auto_resume_min_gap_sec?: number;
  mini5_fallback_enabled?: boolean;
  has_airtable_key?: boolean;
  has_monday_key?: boolean;
  has_drive_oauth?: boolean;
};

export type ExplorerStats = {
  totalRuns: number;
  completed: number;
  failed: number;
  findingsOpen: number;
  draftsProposed: number;
  draftsShipped: number;
  ledgerCount: number;
};

export type ExplorerHealth = {
  enabled: boolean;
  interval_minutes: number;
  last_run_at: string | null;
  next_due_at: string | null;
  overdue_minutes: number;
  runs_total: number;
  runs_completed: number;
  runs_failed: number;
};
