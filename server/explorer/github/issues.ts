// GitHub issue creation + batch grouping (split from github-sync.ts).

import type { DraftTask } from "@shared/schema";
import { storage } from "../../storage";
import { pickRepoForTask, inferArea, extractPrefix, parseEffortHours } from "./repo-routing";
import { renderChildIssueBody, renderMasterIssueBody, renderSoloIssueBody, groupChildrenByPhase } from "./render";
import { ghFetch, ensureLabels } from "./client";

export type GhIssueResult = { ok: boolean; number?: number; url?: string; error?: string };

// Create a SOLO standalone issue (no parent tracker)
export async function createSoloIssueForTask(t: DraftTask, ctx: { source_url: string; run_id: number }): Promise<GhIssueResult> {
  const cfg = storage.getCronConfig();
  const repo = t.gh_repo ?? pickRepoForTask(t, { default_gh_repo: cfg.default_gh_repo, frontend_gh_repo: cfg.frontend_gh_repo });
  const area = inferArea(t);
  const labels = ["autonomy-hub", `priority:${t.priority}`, `area:${area}`];
  const body = renderSoloIssueBody(t, ctx);
  try {
    await ensureLabels(repo, labels);
    const res = await ghFetch(`/repos/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({ title: t.title, body, labels }),
    });
    if (!res.ok) return { ok: false, error: `${res.status}: ${(await res.text()).slice(0, 400)}` };
    const issue = await res.json() as any;
    storage.updateDraftTask(t.id, {
      gh_issue_number: issue.number,
      gh_repo: repo,
      gh_issue_url: issue.html_url,
      gh_synced_at: new Date().toISOString(),
      area,
    });
    return { ok: true, number: issue.number, url: issue.html_url };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Backward-compat alias for the v4 routes that still import this name
export const createIssueForTask = createSoloIssueForTask;

// Create a FLEET-style master tracker + N child issues for a batched group.
// Order:
//   1. Create the master with placeholder child refs.
//   2. Create each child issue, linking back to the master.
//   3. Update the master body with real child issue numbers.
export async function createBatchedFleetTracker(group: BatchGroup, ctx: { source_url: string; run_id: number; branch_base?: string; current_state_lines?: string[]; constraints?: string[] }): Promise<{
  master: GhIssueResult;
  children: { draft_id: number; result: GhIssueResult }[];
}> {
  const cfg = storage.getCronConfig();
  const repo = group.repo;
  const masterLabels = ["autonomy-hub", "tracker", `priority:${group.priority}`, `area:${group.area}`];

  // Build initial master body with placeholder child refs
  const childRefsPlaceholder = group.tasks.map((t) => ({
    prefix: extractPrefix(t.title) ?? `AH-${group.area.toUpperCase()}-${t.id}`,
    title: t.title,
    issueNumber: undefined as number | undefined,
  }));
  const masterTitle = `[AH-MASTER-${group.area.toUpperCase()}-R${ctx.run_id}] ${group.area} cluster — ${group.tasks.length} children (${group.priority.toUpperCase()})`;
  const masterBody1 = renderMasterIssueBody(group, { ...ctx, childRefs: childRefsPlaceholder });

  await ensureLabels(repo, masterLabels);
  const masterRes = await ghFetch(`/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title: masterTitle, body: masterBody1, labels: masterLabels }),
  });
  if (!masterRes.ok) {
    return { master: { ok: false, error: `master ${masterRes.status}: ${(await masterRes.text()).slice(0, 400)}` }, children: [] };
  }
  const masterIssue = await masterRes.json() as any;
  const masterRef = { number: masterIssue.number, url: masterIssue.html_url };

  // Create children referencing master
  const childResults: { draft_id: number; result: GhIssueResult; prefix: string }[] = [];
  for (const t of group.tasks) {
    const prefix = extractPrefix(t.title) ?? `AH-${group.area.toUpperCase()}-${t.id}`;
    const childLabels = ["autonomy-hub", `priority:${t.priority}`, `area:${group.area}`];
    const childBody = renderChildIssueBody(t, { master_issue: masterRef, source_url: ctx.source_url, run_id: ctx.run_id });
    try {
      await ensureLabels(repo, childLabels);
      const r = await ghFetch(`/repos/${repo}/issues`, {
        method: "POST",
        body: JSON.stringify({ title: t.title, body: childBody, labels: childLabels }),
      });
      if (!r.ok) {
        childResults.push({ draft_id: t.id, prefix, result: { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 400)}` } });
        continue;
      }
      const issue = await r.json() as any;
      storage.updateDraftTask(t.id, {
        gh_issue_number: issue.number,
        gh_repo: repo,
        gh_issue_url: issue.html_url,
        gh_synced_at: new Date().toISOString(),
        area: group.area,
      });
      childResults.push({ draft_id: t.id, prefix, result: { ok: true, number: issue.number, url: issue.html_url } });
    } catch (err: any) {
      childResults.push({ draft_id: t.id, prefix, result: { ok: false, error: err?.message ?? String(err) } });
    }
  }

  // Patch master body with real child issue numbers
  const childRefsFinal = childResults.map((c) => ({
    prefix: c.prefix,
    title: group.tasks.find((t) => t.id === c.draft_id)!.title,
    issueNumber: c.result.number,
  }));
  const masterBody2 = renderMasterIssueBody(group, { ...ctx, childRefs: childRefsFinal });
  try {
    await ghFetch(`/repos/${repo}/issues/${masterIssue.number}`, {
      method: "PATCH",
      body: JSON.stringify({ body: masterBody2 }),
    });
  } catch { /* ignore */ }

  return {
    master: { ok: true, number: masterIssue.number, url: masterIssue.html_url },
    children: childResults.map((c) => ({ draft_id: c.draft_id, result: c.result })),
  };
}

// ============ Batch grouping ============

export type BatchGroup = {
  key: string;
  repo: string;
  area: string;
  priority: string;
  tasks: DraftTask[];
};

export function groupDrafts(tasks: DraftTask[], cfg: { default_gh_repo: string; frontend_gh_repo: string }): BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const t of tasks) {
    const repo = t.gh_repo ?? pickRepoForTask(t, cfg);
    const area = t.area ?? inferArea(t);
    const key = `${repo}::${area}::${t.priority}`;
    if (!groups.has(key)) groups.set(key, { key, repo, area, priority: t.priority, tasks: [] });
    groups.get(key)!.tasks.push(t);
  }
  return Array.from(groups.values());
}

// Compose a "merged" record for the local DB (so the platform shows a master row in the Backlog).
// The actual GitHub issues are created by createBatchedFleetTracker.
export function composeMergedTask(group: BatchGroup, run_id: number): {
  title: string;
  description: string;
  project_slug: string;
  repo_url: string;
  priority: string;
  relevant_skills_json: string;
  effort_estimate: string;
  agent_briefing: string;
  batch_id: string;
  area: string;
} {
  const tasks = group.tasks;
  const skills = new Set<string>();
  tasks.forEach((t) => {
    try { (JSON.parse(t.relevant_skills_json || "[]") as string[]).forEach((s) => skills.add(s)); } catch { /* */ }
  });
  const totalEffortHrs = tasks.reduce((s, t) => s + parseEffortHours(t.effort_estimate), 0);
  const effortStr = `${totalEffortHrs.toFixed(0)} hrs across ${tasks.length} children`;
  const firstRepo = tasks[0].repo_url;
  const firstSlug = tasks[0].project_slug;

  const title = `[AH-MASTER-${group.area.toUpperCase()}-R${run_id}] ${group.area} cluster — ${tasks.length} children (${group.priority.toUpperCase()})`;
  const description = `FLEET-style tracker for ${tasks.length} ${group.area} sub-tasks from Explorer run #${run_id}. Each child has its own 8-H2 briefing + Acceptance criteria; the master tracks completion via checkboxes that auto-update when children close.`;

  // The briefing in the local DB summarises the structure; GitHub renders the full FLEET format.
  const briefing = [
    `## Goal`,
    `Coordinate ${tasks.length} related ${group.area} sub-tasks. This is a master tracker — each sub-task ships as its own GitHub issue with its own branch + PR.`,
    ``,
    `## Phases (${tasks.length} children)`,
    ...groupChildrenByPhase(tasks).map((p) => `### ${p.name}\n${p.tasks.map((t) => `- [ ] ${extractPrefix(t.title) ?? `AH-${group.area.toUpperCase()}-${t.id}`} — ${t.title.replace(/^\[[^\]]+\]\s*/, "")}`).join("\n")}`),
    ``,
    `## Constraints for all children`,
    `- Each child PR must include per-task tests passing at ≥ 90% rate before merge`,
    `- Branch naming: \`feat/${group.area}-<prefix>-<short>\``,
    `- \`npx tsc --noEmit\` clean before push`,
    `- \`npx vitest run\` clean before push`,
    `- All LLM calls through \`CompletionProvider\` DI`,
    `- Reference this tracker (and source draft id) in every child PR body`,
    ``,
    `## Children (with source draft links)`,
    ...tasks.map((t, i) => `${i + 1}. \`${extractPrefix(t.title) ?? "—"}\` (Autonomy Hub draft #${t.id}) — ${t.title.replace(/^\[[^\]]+\]\s*/, "")}`),
    ``,
    `## Notes`,
    `- Master is auto-managed by the Autonomy Hub.`,
    `- Closing a child auto-checks its box in the master.`,
    `- See each child issue for full 8-H2 implementation detail.`,
  ].join("\n");

  return {
    title,
    description,
    project_slug: firstSlug,
    repo_url: firstRepo,
    priority: group.priority,
    relevant_skills_json: JSON.stringify(Array.from(skills)),
    effort_estimate: effortStr,
    agent_briefing: briefing,
    batch_id: `ah-master-${group.area}-r${run_id}`,
    area: group.area,
  };
}
