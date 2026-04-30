// Per-action extras that didn't fit cleanly in the primary seed.
// Used by Action Detail v2, Money Path page, and HITL Burden page.
import { ACTIONS } from "./actions-seed";

export type ActionExtras = {
  // Cost/SLA budgets per run from cos_action_registry
  p95_sla_ms: number;
  p95_cost_budget_usd: number;
  // Avg runs per active brand per week (used to compute throughput)
  weekly_runs_per_brand: number;
  // If HITL = tina_review, est. minutes per review
  human_minutes_per_run: number;
  // Sister actions in the same workflow (lift this to suggest co-promotion)
  sister_actions: string[];
  // Upstream actions this depends on
  upstream: string[];
  // Downstream actions this feeds
  downstream: string[];
  // Money-path flag (extra-scrutiny class)
  money_path: boolean;
  // Sample handler-version timeline (releases)
  timeline: { date: string; label: string }[];
};

const ZERO_EXTRAS: ActionExtras = {
  p95_sla_ms: 5000,
  p95_cost_budget_usd: 0.05,
  weekly_runs_per_brand: 5,
  human_minutes_per_run: 3,
  sister_actions: [],
  upstream: [],
  downstream: [],
  money_path: false,
  timeline: [],
};

const E: Record<string, Partial<ActionExtras>> = {
  // SAMPLING workflow chain
  generate_creative_brief: { weekly_runs_per_brand: 1, human_minutes_per_run: 12, downstream: ["validate_brand_assets", "publish_compliance_rules", "draft_outreach_messages"], timeline: [
    { date: "2026-02-12", label: "v1 stub" },
    { date: "2026-03-15", label: "v2 brand-kit ingest" },
    { date: "2026-04-08", label: "v3 voice scorer added (78% pass)" },
  ]},
  validate_brand_assets: { weekly_runs_per_brand: 0.5, human_minutes_per_run: 0, p95_cost_budget_usd: 0, upstream: ["generate_creative_brief"], downstream: ["draft_outreach_messages"]},
  publish_compliance_rules: { weekly_runs_per_brand: 0.2, human_minutes_per_run: 8, downstream: ["validate_draft_quality"]},
  discover_creators: { weekly_runs_per_brand: 6, human_minutes_per_run: 0, p95_cost_budget_usd: 0.02, downstream: ["score_and_select_creators", "evaluate_creator_eligibility"], timeline: [
    { date: "2026-03-10", label: "v1 Kalodata-only" },
    { date: "2026-04-01", label: "v2 + Fastmoss" },
    { date: "2026-04-24", label: "v3 outcome ladder + 100 fixtures (#3614)" },
  ]},
  score_and_select_creators: { weekly_runs_per_brand: 6, human_minutes_per_run: 4, sister_actions: ["evaluate_creator_eligibility"], upstream: ["discover_creators"], downstream: ["draft_outreach_messages"], timeline: [
    { date: "2026-04-24", label: "find_tier_by_gmv extracted (#3610, #3611)" },
    { date: "2026-04-29", label: "scoreAffiliate null guard + scheduler edges (#4224)" },
  ]},
  evaluate_creator_eligibility: { weekly_runs_per_brand: 6, human_minutes_per_run: 0, sister_actions: ["score_and_select_creators"], upstream: ["discover_creators"], downstream: ["draft_outreach_messages"], timeline: [
    { date: "2026-04-24", label: "classify_creator + dormancy archetype (#3609)" },
  ]},
  draft_outreach_messages: { weekly_runs_per_brand: 25, human_minutes_per_run: 2, p95_cost_budget_usd: 0.04, sister_actions: ["validate_draft_quality", "send_creator_message"], upstream: ["score_and_select_creators"], downstream: ["validate_draft_quality"]},
  validate_draft_quality: { weekly_runs_per_brand: 25, human_minutes_per_run: 0, p95_cost_budget_usd: 0.01, upstream: ["draft_outreach_messages"], downstream: ["send_creator_message"]},
  send_creator_message: { weekly_runs_per_brand: 25, human_minutes_per_run: 0.3, upstream: ["validate_draft_quality"], downstream: ["detect_and_route_intent"]},
  detect_and_route_intent: { weekly_runs_per_brand: 30, human_minutes_per_run: 0, p95_cost_budget_usd: 0.005, p95_sla_ms: 500, upstream: ["send_creator_message"], downstream: ["evaluate_offer_request"], timeline: [
    { date: "2026-04-15", label: "v5 hybrid classifier (1088-case corpus)" },
    { date: "2026-04-24", label: "v5 wired into prod (#3605, #3606, #3607, #3613)" },
  ]},
  evaluate_offer_request: { weekly_runs_per_brand: 8, human_minutes_per_run: 4, sister_actions: ["auto_approve_or_route_to_hitl"], upstream: ["detect_and_route_intent"], downstream: ["send_approval_response"], timeline: [
    { date: "2026-04-24", label: "3-way decision + counter trigger (#3616)" },
  ]},
  auto_approve_or_route_to_hitl: { weekly_runs_per_brand: 8, human_minutes_per_run: 1, upstream: ["evaluate_offer_request"], downstream: ["send_approval_response"], timeline: [
    { date: "2026-04-24", label: "auto_approve_draft + CARE gate + 100 fixtures (#3608)" },
  ]},
  send_approval_response: { weekly_runs_per_brand: 8, human_minutes_per_run: 1.5, upstream: ["auto_approve_or_route_to_hitl"], downstream: ["record_outcome"]},
  record_outcome: { weekly_runs_per_brand: 8, human_minutes_per_run: 0, upstream: ["send_approval_response"]},

  // PAID DEAL chain
  calculate_reactivation_roi_potential: { weekly_runs_per_brand: 4, human_minutes_per_run: 0, sister_actions: ["evaluate_reactivation_eligibility"], downstream: ["evaluate_reactivation_eligibility"]},
  evaluate_reactivation_eligibility: { weekly_runs_per_brand: 4, human_minutes_per_run: 0, sister_actions: ["calculate_reactivation_roi_potential"], upstream: ["calculate_reactivation_roi_potential"], timeline: [
    { date: "2026-04-24", label: "classifyDormancy + 100 fixtures (#3612)" },
    { date: "2026-04-26", label: "Production ship (#3790)" },
  ]},
  identify_top_sellers_needing_push: { weekly_runs_per_brand: 1, human_minutes_per_run: 6, downstream: ["calculate_ltv_push_roi_potential"]},
  calculate_ltv_push_roi_potential: { weekly_runs_per_brand: 1, human_minutes_per_run: 0, upstream: ["identify_top_sellers_needing_push"]},
  query_pricing_intelligence: { weekly_runs_per_brand: 5, human_minutes_per_run: 0, downstream: ["calculate_optimal_offer", "check_roas_projection"]},
  get_historical_gmv: { weekly_runs_per_brand: 12, human_minutes_per_run: 0, p95_sla_ms: 200, downstream: ["calculate_optimal_offer"]},
  calculate_optimal_offer: { weekly_runs_per_brand: 5, human_minutes_per_run: 6, p95_cost_budget_usd: 0.06, sister_actions: ["check_roas_projection"], upstream: ["query_pricing_intelligence", "get_historical_gmv"], downstream: ["send_offer"]},
  send_offer: { weekly_runs_per_brand: 5, human_minutes_per_run: 1.5, upstream: ["calculate_optimal_offer"], downstream: ["evaluate_counter_offer", "auto_accept_or_route_to_hitl"]},
  evaluate_counter_offer: { weekly_runs_per_brand: 3, human_minutes_per_run: 7, sister_actions: ["check_roas_projection"], upstream: ["send_offer"], downstream: ["auto_accept_or_route_to_hitl"], timeline: [
    { date: "2026-04-24", label: "wire generate_counter_response to CARE (#3617)" },
  ]},
  check_roas_projection: { weekly_runs_per_brand: 5, human_minutes_per_run: 0, sister_actions: ["calculate_optimal_offer"], downstream: ["auto_accept_or_route_to_hitl"]},
  auto_accept_or_route_to_hitl: { weekly_runs_per_brand: 3, human_minutes_per_run: 2, upstream: ["evaluate_counter_offer", "check_roas_projection"], downstream: ["generate_agreement"]},
  generate_agreement: { weekly_runs_per_brand: 3, human_minutes_per_run: 8, p95_cost_budget_usd: 0.08, upstream: ["auto_accept_or_route_to_hitl"], downstream: ["send_contract"]},
  send_contract: { weekly_runs_per_brand: 3, human_minutes_per_run: 2, upstream: ["generate_agreement"], downstream: ["request_w9", "set_content_brief_if_new"]},
  request_w9: { weekly_runs_per_brand: 1, human_minutes_per_run: 4, upstream: ["send_contract"]},
  set_content_brief_if_new: { weekly_runs_per_brand: 3, human_minutes_per_run: 0, upstream: ["send_contract"], downstream: ["auto_approve_or_request_revision"]},
  auto_approve_or_request_revision: { weekly_runs_per_brand: 12, human_minutes_per_run: 4, upstream: ["set_content_brief_if_new"], downstream: ["count_qualifying_posts"]},
  count_qualifying_posts: { weekly_runs_per_brand: 12, human_minutes_per_run: 0, money_path: true, upstream: ["auto_approve_or_request_revision"], downstream: ["verify_bundle_completion"], timeline: [
    { date: "2026-04-24", label: "money-path build (#3460)" },
  ]},
  verify_bundle_completion: { weekly_runs_per_brand: 5, human_minutes_per_run: 5, money_path: true, upstream: ["count_qualifying_posts"], downstream: ["calculate_total_compensation"], timeline: [
    { date: "2026-04-23", label: "param-trust drift fix (#3466)" },
    { date: "2026-04-23", label: "production ship (#3278)" },
  ]},
  calculate_total_compensation: { weekly_runs_per_brand: 5, human_minutes_per_run: 4, money_path: true, upstream: ["verify_bundle_completion"], downstream: ["process_fixed_rate_payment"]},
  process_fixed_rate_payment: { weekly_runs_per_brand: 5, human_minutes_per_run: 6, money_path: true, p95_cost_budget_usd: 0.5, upstream: ["calculate_total_compensation"], downstream: ["reconcile_payment"]},
  reconcile_payment: { weekly_runs_per_brand: 5, human_minutes_per_run: 5, money_path: true, upstream: ["process_fixed_rate_payment"], downstream: ["emit_learning_hook"]},
  emit_learning_hook: { weekly_runs_per_brand: 30, human_minutes_per_run: 0, upstream: ["reconcile_payment"]},
  emit_graduation_event: { weekly_runs_per_brand: 0.5, human_minutes_per_run: 0 },
  escalate_to_manager: { weekly_runs_per_brand: 1, human_minutes_per_run: 15, timeline: [
    { date: "2026-04-24", label: "5-rule composition (#3615)" },
  ]},
  pause_campaign_spend: { weekly_runs_per_brand: 0.1, human_minutes_per_run: 30 },
  auto_revert_rule: { weekly_runs_per_brand: 0.05, human_minutes_per_run: 25, timeline: [
    { date: "2026-04-25 (planned)", label: "page-hinkley drift wire (#3363)" },
    { date: "2026-04-30 (planned)", label: "weekly retrain cron (#3364)" },
  ]},
};

export function getExtras(action_name: string): ActionExtras {
  return { ...ZERO_EXTRAS, ...E[action_name] };
}

// HITL hours per week, assuming N active brands
export function hitlHoursPerWeek(activeBrands = 37) {
  return ACTIONS.map((a) => {
    const x = getExtras(a.action_name);
    const minutesIfTina = a.hitl_gate === "tina_review" ? x.human_minutes_per_run : 0;
    const totalMin = minutesIfTina * x.weekly_runs_per_brand * activeBrands;
    return {
      action_name: a.action_name,
      display_name: a.display_name,
      class: a.class,
      hitl_gate: a.hitl_gate,
      eval_pass_pct: a.eval_pass_pct,
      prod_readiness_pct: a.prod_readiness_pct,
      weekly_runs: x.weekly_runs_per_brand * activeBrands,
      minutes_per_run: x.human_minutes_per_run,
      hours_per_week: totalMin / 60,
      promotable: a.hitl_gate === "tina_review" && (a.eval_pass_pct ?? 0) >= 90,
    };
  });
}
