// Live feed of recent autonomy-related GitHub merges (last 9 days)
// Sourced via gh CLI on 2026-04-29, capped to top items relevant to autonomy.
export type FeedItem = {
  number: number;
  title: string;
  date: string; // YYYY-MM-DD
  state: "MERGED" | "OPEN" | "CLOSED";
  category: "autonomy" | "fleet" | "ux" | "infra" | "matching" | "evals";
  action_hint?: string; // optional action_name link
};

export const LIVE_FEED: FeedItem[] = [
  { number: 4229, title: "fix(fleet): single-flight codex token refresh", date: "2026-04-30", state: "MERGED", category: "fleet" },
  { number: 4228, title: "Fix transient Neon failure retries in cron handlers", date: "2026-04-30", state: "MERGED", category: "infra" },
  { number: 4227, title: "feat(matching): batch/live parity master guard (run 82)", date: "2026-04-29", state: "MERGED", category: "matching", action_hint: "score_and_select_creators" },
  { number: 4226, title: "feat: UX enhancements — 20260429", date: "2026-04-29", state: "MERGED", category: "ux" },
  { number: 4225, title: "feat(CC-RESILIENCE-19): Neon connection pool + circuit breaker on storage hot path", date: "2026-04-29", state: "MERGED", category: "infra" },
  { number: 4224, title: "feat(matching): scoreAffiliate null guard + scheduler edge cases (run 81)", date: "2026-04-29", state: "MERGED", category: "matching", action_hint: "score_and_select_creators" },
  { number: 4076, title: "feat(autonomy): wire 8 reactive creator actions to existing pure modules", date: "2026-04-28", state: "MERGED", category: "autonomy" },
  { number: 3793, title: "feat(autonomy): per-action 3-metric scorecard dashboard (closes #3620)", date: "2026-04-26", state: "MERGED", category: "evals" },
  { number: 3790, title: "feat(autonomy): classifyDormancy action + 100 fixtures (closes #3612)", date: "2026-04-26", state: "MERGED", category: "autonomy", action_hint: "evaluate_reactivation_eligibility" },
  { number: 3617, title: "wire generate_counter_response to CARE response generator", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "evaluate_counter_offer" },
  { number: 3616, title: "expand evaluate_organic_offer to 3-way decision + counter trigger", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "evaluate_offer_request" },
  { number: 3615, title: "build evaluate_escalation handler with 5-rule composition", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "escalate_to_manager" },
  { number: 3614, title: "discover_creators outcome ladder + 100 fixtures + learning-engine scoring", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "discover_creators" },
  { number: 3613, title: "detect_and_route_intent — replace legacy keyword matching with hybrid v5", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "detect_and_route_intent" },
  { number: 3612, title: "register classifyDormancy as automation action + 100 real fixtures", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "evaluate_reactivation_eligibility" },
  { number: 3611, title: "implement find_tier_by_gmv handler", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "score_and_select_creators" },
  { number: 3610, title: "extract findTierByGmv pure function + register as LIVE action", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "score_and_select_creators" },
  { number: 3609, title: "augment classify_creator with dormancy archetype + 100 real fixtures", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "evaluate_creator_eligibility" },
  { number: 3608, title: "ship auto_approve_draft with CARE score gate + 100 real fixtures", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "auto_approve_or_route_to_hitl" },
  { number: 3607, title: "$50/day budget throttle + observation logging for LLM classifier", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "detect_and_route_intent" },
  { number: 3606, title: "add AnthropicCompletionProvider + per-shop feature flag", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "detect_and_route_intent" },
  { number: 3605, title: "wire classifyHybrid into detect_and_route_intent handler", date: "2026-04-24", state: "MERGED", category: "autonomy", action_hint: "detect_and_route_intent" },
];

export const OPEN_BLOCKERS: FeedItem[] = [
  { number: 3474, title: "v3.1: Missing 6,452 PA records data feed — blocks PD9/PD11/PD13 unstub", date: "2026-04-22", state: "OPEN", category: "autonomy" },
  { number: 3604, title: "[FLEET] Autonomy action completion — R196-R250 tracker (20 children)", date: "2026-04-23", state: "OPEN", category: "autonomy" },
];
