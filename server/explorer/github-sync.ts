// GitHub issue synchronization for Autonomy Hub draft tasks.
// FLEET tracker pattern (modeled on bemomentiq/momentiq-dna#3604):
//   - One MASTER tracker issue per area, with Goal / Current state / Phases (checkbox children) / Constraints / Branch.
//   - One CHILD issue per sub-task, linked from the master via "- [ ] CHILD-PREFIX-N #issue-num title".
// Single un-batched tasks still ship as standalone issues but with the same 8-H2 + Constraints structure.
//
// This file is now a thin barrel re-exporting the modules under ./github/.
// The implementation was split into:
//   github/repo-routing.ts — pickRepoForTask, inferArea, extractPrefix, parseEffortHours
//   github/render.ts       — render*Body, parseAgentBriefingSections, phaseFromPrefix, groupChildrenByPhase
//   github/client.ts       — resolveToken, resolveApiHost, ghFetch, ensureLabels
//   github/issues.ts       — createSoloIssueForTask (+ alias), createBatchedFleetTracker, groupDrafts, composeMergedTask, BatchGroup/GhIssueResult

export { pickRepoForTask, inferArea, extractPrefix } from "./github/repo-routing";
export { renderChildIssueBody, renderMasterIssueBody, renderSoloIssueBody } from "./github/render";
export { createSoloIssueForTask, createIssueForTask, createBatchedFleetTracker, groupDrafts, composeMergedTask } from "./github/issues";
export type { GhIssueResult, BatchGroup } from "./github/issues";
