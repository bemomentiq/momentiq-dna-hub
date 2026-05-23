// Fleet dispatch routes for the executor cron and ad-hoc runs.
// Both kinds share the same fleet_runs table, the same dispatch shape, and the
// same fallback discipline (pin-codex / gpt_5_5 primary -> pin-claude / claude_opus_4_7 fallback).
//
// This file is now a thin barrel re-exporting the modules under ./fleet/.
// The implementation was split into:
//   fleet/briefings.ts        — buildExecutorBriefing, buildEpicExecutorBriefing, buildCodebaseAuditBriefing, buildAdHocBriefing
//   fleet/dispatch-helpers.ts — ccDispatch, fetchGhContext
//   fleet/routes.ts           — registerFleetRoutes (all route registrations, same order)

export { registerFleetRoutes } from "./fleet/routes";
export { buildExecutorBriefing, buildEpicExecutorBriefing, buildCodebaseAuditBriefing, buildAdHocBriefing } from "./fleet/briefings";
