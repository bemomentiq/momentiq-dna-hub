// GitHub issue synchronization for Autonomy Hub draft tasks.
// FLEET tracker pattern (modeled on bemomentiq/momentiq-dna#3604):
//   - One MASTER tracker issue per area, with Goal / Current state / Phases (checkbox children) / Constraints / Branch.
//   - One CHILD issue per sub-task, linked from the master via "- [ ] CHILD-PREFIX-N #issue-num title".
// Single un-batched tasks still ship as standalone issues but with the same 8-H2 + Constraints structure.

import type { DraftTask } from "@shared/schema";
import { storage } from "../storage";

// Repo mapping
export function pickRepoForTask(t: DraftTask, cfg: { default_gh_repo: string; frontend_gh_repo: string }): string {
  if (t.repo_url?.includes("-frontend")) return cfg.frontend_gh_repo;
  if (t.area && /^(ui|frontend|fe|visual|dashboard)$/i.test(t.area)) return cfg.frontend_gh_repo;
  try {
    const skills: string[] = JSON.parse(t.relevant_skills_json || "[]");
    if (skills.some((s) => /website|webapp|frontend|ui/i.test(s))) return cfg.frontend_gh_repo;
  } catch { /* */ }
  return cfg.default_gh_repo;
}

const AREA_KEYWORDS: { area: string; patterns: RegExp[] }[] = [
  { area: "evals", patterns: [/eval_pass/, /scorer/i, /\bevals\b/i, /quality score/i, /SCORER_VERSION/] },
  { area: "drift", patterns: [/drift/i, /page-hinkley/i, /\brho\b/i, /auto[_-]revert/i] },
  { area: "money-path", patterns: [/money[- ]path/i, /payment/i, /reconcil/i, /compensation/i, /fixed[_ ]rate/i] },
  { area: "training-data", patterns: [/training (?:data|corpus|rows|backfill)/i, /Reacher/i, /cross.shop learnings/i, /gold pairs/i] },
  { area: "hitl", patterns: [/HITL/i, /tina_review/i, /hitl_decision_log/i, /gate flip/i] },
  { area: "pipeline", patterns: [/pipeline/i, /ingest/i, /ETL/i, /cron/i] },
  { area: "sampling", patterns: [/sampling/i, /outreach/i, /\bdraft[_ ]outreach/i] },
  { area: "paid-deal", patterns: [/paid_deal/i, /PD\d+/, /offer/i, /contract/i] },
  { area: "frontend", patterns: [/\bUI\b/, /frontend/i, /dashboard/i, /React component/i, /\.tsx/] },
];

export function inferArea(t: Pick<DraftTask, "title" | "description" | "agent_briefing" | "relevant_skills_json" | "area">): string {
  if (t.area) return t.area;
  const corpus = `${t.title}\n${t.description}\n${t.agent_briefing}`;
  for (const { area, patterns } of AREA_KEYWORDS) {
    if (patterns.some((p) => p.test(corpus))) return area;
  }
  return "general";
}

// Parse the [PREFIX-N] from a draft title, e.g. "[AH-EXPLORE-1] foo" -> "AH-EXPLORE-1"
export function extractPrefix(title: string): string | null {
  const m = title.match(/^\[([A-Z0-9][A-Z0-9_-]+)\]/);
  return m?.[1] ?? null;
}

// ============ Body renderers ============

// CHILD issue body — one per sub-task. Modeled on canonical FLEET children
// (Shop-Insights-Dashboard#3605, #3608) which use **bold-prefix sections** rather
// than nested H2 headers, keeping the body terse and scannable. The 8-H2 agent
// briefing supplied by the Explorer is preserved verbatim as the body of the
// **Implementation** section so the lane that picks up this issue still has the
// full plan it needs.
export function renderChildIssueBody(t: DraftTask, ctx: { master_issue?: { number: number; url: string }; source_url: string; run_id: number }): string {
  const area = inferArea(t);
  const prefix = extractPrefix(t.title) ?? `AH-${area.toUpperCase()}-${t.id}`;
  const phaseLabel = phaseFromPrefix(prefix);

  // Try to extract canonical sub-sections from the agent_briefing (the Explorer
  // emits an 8-H2 markdown block). If the briefing IS structured 8-H2, we hoist
  // its top-level sections to bold-prefix. Otherwise we fall back to embedding it.
  const sections = parseAgentBriefingSections(t.agent_briefing);
  const goal = sections.Goal || t.description;
  const context = sections.Context || "";
  const files = sections.Files || "";
  const implementation = sections.Implementation || (sections.Goal ? "" : t.agent_briefing);
  const acceptance = sections.Acceptance || "";
  const outOfScope = sections["Out-of-scope"] || sections["Out of scope"] || "";
  const commitPr = sections["Commit + PR"] || "";
  const notes = sections.Notes || "";

  const lines: string[] = [];
  if (ctx.master_issue) lines.push(`**Parent:** #${ctx.master_issue.number}`);
  if (phaseLabel) lines.push(`**Phase:** ${phaseLabel}`);
  lines.push(`**Prefix:** \`${prefix}\``);
  lines.push(`**Priority:** ${t.priority.toUpperCase()} · **Area:** \`${area}\` · **Effort:** ${t.effort_estimate}`);
  lines.push(``);
  lines.push(`**Goal**`);
  lines.push(goal.trim() || "(no goal supplied)");
  if (context.trim()) {
    lines.push(``);
    lines.push(`**Context**`);
    lines.push(context.trim());
  }
  if (files.trim()) {
    lines.push(``);
    lines.push(`**Files**`);
    lines.push(files.trim());
  }
  if (implementation.trim()) {
    lines.push(``);
    lines.push(`**Implementation**`);
    lines.push(implementation.trim());
  }
  if (acceptance.trim()) {
    lines.push(``);
    lines.push(`**Acceptance**`);
    lines.push(acceptance.trim());
  }
  if (outOfScope.trim()) {
    lines.push(``);
    lines.push(`**Out-of-scope**`);
    lines.push(outOfScope.trim());
  }
  if (commitPr.trim()) {
    lines.push(``);
    lines.push(`**Commit + PR**`);
    lines.push(commitPr.trim());
  } else {
    // Always emit a Commit + PR section even if the briefing didn't include one
    lines.push(``);
    lines.push(`**Commit + PR**`);
    lines.push(`Branch: \`feat/${area}-${prefix.toLowerCase()}-<short>\``);
  }
  if (notes.trim()) {
    lines.push(``);
    lines.push(`**Notes**`);
    lines.push(notes.trim());
  }
  lines.push(``);
  lines.push(`---`);
  lines.push(`_Auto-filed by Autonomy Hub Explorer · run #${ctx.run_id} · draft #${t.id} · [source](${ctx.source_url})_`);

  return lines.join("\n");
}

// Parse an 8-H2 agent briefing into a section map keyed by H2 title.
// Tolerates trailing whitespace, mixed-case, and the canonical 8 sections.
function parseAgentBriefingSections(briefing: string): Record<string, string> {
  const sections: Record<string, string> = {};
  if (!briefing) return sections;
  const lines = briefing.split(/\r?\n/);
  let current: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      if (current) sections[current] = buf.join("\n").trim();
      current = m[1];
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections[current] = buf.join("\n").trim();
  return sections;
}

// Map a prefix (e.g. CLASSIFIER-WIRE-1, EVAL-OUTCOME-REWARD, AUTONOMY-AUTO-APPROVE)
// to a human-readable phase label following canonical conventions.
function phaseFromPrefix(prefix: string): string {
  if (/^CLASSIFIER-WIRE/i.test(prefix) || /^FEATURE-WIRE/i.test(prefix) || /^HANDLER-WIRE/i.test(prefix)) return "A — Wire-up";
  if (/^AUTONOMY-/i.test(prefix)) return "B — Per-action implementation";
  if (/^EVAL-/i.test(prefix) || /SCORECARD/i.test(prefix)) return "C — Outcome-based evals";
  if (/^DATA-/i.test(prefix)) return "D — Additional data sources";
  if (/^DRIFT-|^RETRAIN-|^AUTO-ROLLBACK/i.test(prefix)) return "E — Drift + auto-retrain";
  if (/^AH-/i.test(prefix)) return "Hub explorer";
  return "";
}

// MASTER tracker body — FLEET-style. Built from a group of related drafts.
// Children are rendered as checkboxes; their actual issue numbers are filled in
// AFTER the children are created (renderMasterIssueBody returns a function that
// patches in numbers).
export function renderMasterIssueBody(group: BatchGroup, ctx: { run_id: number; source_url: string; childRefs: { prefix: string; issueNumber?: number; title: string }[]; constraints?: string[]; branch_base?: string; current_state_lines?: string[] }): string {
  const phases = groupChildrenByPhase(group.tasks);
  const phaseSection = phases.map((p) => {
    const items = p.tasks.map((t) => {
      const prefix = extractPrefix(t.title) ?? `AH-${group.area.toUpperCase()}-${t.id}`;
      const ref = ctx.childRefs.find((c) => c.prefix === prefix);
      const link = ref?.issueNumber ? `#${ref.issueNumber}` : "(pending)";
      const cleaned = t.title.replace(/^\[[^\]]+\]\s*/, "");
      return `- [ ] \`${prefix}\` ${link} — ${cleaned}`;
    }).join("\n");
    return `### ${p.name}\n${items}`;
  }).join("\n\n");

  const totalEffort = group.tasks.reduce((s, t) => s + parseEffortHours(t.effort_estimate), 0);
  const skills = new Set<string>();
  group.tasks.forEach((t) => {
    try { (JSON.parse(t.relevant_skills_json || "[]") as string[]).forEach((s) => skills.add(s)); } catch { /* */ }
  });

  const constraintLines = ctx.constraints && ctx.constraints.length ? ctx.constraints : [
    `Each child PR must include per-task tests passing at ≥ 90% rate before merge`,
    `Branch naming: \`feat/${group.area}-<prefix>-<short>\``,
    `\`npx tsc --noEmit\` clean before push`,
    `\`npx vitest run\` clean before push`,
    `All LLM calls through \`CompletionProvider\` DI (no hardcoded Anthropic / OpenAI calls)`,
    `Reference this tracker (#${"<this issue>"}) in every child PR body`,
  ];

  const currentStateLines = ctx.current_state_lines && ctx.current_state_lines.length
    ? ctx.current_state_lines
    : [`Inferred from Autonomy Hub run #${ctx.run_id}. ${group.tasks.length} sub-tasks queued under area=\`${group.area}\`, priority=\`${group.priority.toUpperCase()}\`. Total estimated effort: ${totalEffort.toFixed(0)} hrs.`];

  return [
    `> **Auto-filed by Autonomy Hub Explorer** · run #${ctx.run_id} · master tracker`,
    `> Source: ${ctx.source_url}`,
    ``,
    `## Goal`,
    `Close the \`${group.area}\` cluster surfaced by Autonomy Hub Explorer run #${ctx.run_id}: ship ${group.tasks.length} related ${group.priority.toUpperCase()} sub-tasks under one coordinated effort. Each child issue contains its own 8-H2 briefing and acceptance criteria.`,
    ``,
    `## Current state (run #${ctx.run_id})`,
    ...currentStateLines.map((l) => `- ${l}`),
    `- Sub-tasks queued: **${group.tasks.length}**`,
    `- Skills required: ${Array.from(skills).map((s) => `\`${s}\``).join(", ") || "(none specified)"}`,
    `- Estimated total effort: **${totalEffort.toFixed(0)} hrs**`,
    ``,
    `## Phases (${group.tasks.length} children below)`,
    ``,
    phaseSection,
    ``,
    `## Constraints for all children`,
    ...constraintLines.map((c) => `- ${c}`),
    ``,
    `## Branch for merge base`,
    `Base branch for first wave: \`${ctx.branch_base ?? "main"}\`. Children should branch off this base, open PRs against it, and merge in dependency order (any child that names a sibling in its Out-of-scope merges AFTER that sibling).`,
    ``,
    `## Coordinator notes`,
    `- Master tracker is auto-managed by the Autonomy Hub. Editing the body is fine; it won't be overwritten.`,
    `- Closing children automatically updates this tracker's checkbox state via GitHub's task-list semantics.`,
    `- If a child surfaces a sibling-blocking issue, append a \`## Blockers\` H2 below this section and reference the offender by issue number.`,
    ``,
    `_Filed by Autonomy Hub Explorer. Source: ${ctx.source_url}_`,
  ].join("\n");
}

// Standalone issue body for un-batched solo tasks
export function renderSoloIssueBody(t: DraftTask, ctx: { run_id: number; source_url: string }): string {
  return renderChildIssueBody(t, { run_id: ctx.run_id, source_url: ctx.source_url });
}

// Group sub-tasks into phase buckets based on prefix patterns or detected sub-area.
type Phase = { name: string; tasks: DraftTask[] };
function groupChildrenByPhase(tasks: DraftTask[]): Phase[] {
  // Phase inference rules:
  //  WIRE-* / *-WIRE-*       => "Phase A — Wire-up"
  //  EVAL-* / *-EVAL-*       => "Phase C — Outcome-based eval layer"
  //  DATA-* / DATA_*         => "Phase D — Additional data sources"
  //  DRIFT-* / RETRAIN-* / AUTO-ROLLBACK => "Phase E — Drift + auto-retrain"
  //  default                 => "Phase B — Implementation"
  const phases: Phase[] = [
    { name: "Phase A — Wire-up", tasks: [] },
    { name: "Phase B — Implementation", tasks: [] },
    { name: "Phase C — Outcome-based eval layer", tasks: [] },
    { name: "Phase D — Additional data sources", tasks: [] },
    { name: "Phase E — Drift + auto-retrain", tasks: [] },
  ];
  for (const t of tasks) {
    const prefix = extractPrefix(t.title) ?? "";
    const hay = `${prefix} ${t.title}`.toUpperCase();
    if (/WIRE|CONNECT|HOOK/.test(hay)) phases[0].tasks.push(t);
    else if (/EVAL|SCORECARD|OUTCOME/.test(hay)) phases[2].tasks.push(t);
    else if (/^DATA[-_]|INGEST|BACKFILL/.test(hay)) phases[3].tasks.push(t);
    else if (/DRIFT|RETRAIN|ROLLBACK|HINKLEY/.test(hay)) phases[4].tasks.push(t);
    else phases[1].tasks.push(t);
  }
  return phases.filter((p) => p.tasks.length > 0);
}

function parseEffortHours(effort: string): number {
  const m = effort.match(/(\d+(?:\.\d+)?)\s*(hr|hour|d|day)/i);
  if (!m) return 2;
  const n = parseFloat(m[1]);
  return /d|day/i.test(m[2]) ? n * 8 : n;
}

// ============ GitHub API ============

async function resolveToken(): Promise<string> {
  const cfg = storage.getCronConfig() as any;
  if (cfg.github_token && String(cfg.github_token).length > 10) return cfg.github_token;
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  if (process.env.GH_ENTERPRISE_TOKEN) return process.env.GH_ENTERPRISE_TOKEN;
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync("gh auth token", { encoding: "utf8", timeout: 3000 }).trim();
    if (out) return out;
  } catch { /* */ }
  throw new Error("GitHub token not configured. Set it via Explorer Settings → GitHub PAT, or set GITHUB_TOKEN env var.");
}

async function resolveApiHost(): Promise<string> {
  if (process.env.GH_HOST && process.env.GH_HOST !== "github.com") {
    return `https://${process.env.GH_HOST}/api/v3`;
  }
  return `https://api.github.com`;
}

async function ghFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await resolveToken();
  const host = await resolveApiHost();
  return fetch(`${host}${path}`, {
    ...init,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function ensureLabels(repo: string, labels: string[]) {
  for (const name of labels) {
    try {
      const r = await ghFetch(`/repos/${repo}/labels/${encodeURIComponent(name)}`);
      if (r.status === 404) {
        await ghFetch(`/repos/${repo}/labels`, {
          method: "POST",
          body: JSON.stringify({
            name,
            color: name.startsWith("priority:p0") ? "d73a4a" : name.startsWith("priority:p1") ? "e5824d" : name.startsWith("priority:p2") ? "fbca04" : name === "autonomy-hub" ? "0e8a16" : name === "tracker" ? "5319e7" : "cfd3d7",
            description: name.startsWith("area:") ? "Autonomy Hub area" : name.startsWith("priority:") ? "Autonomy Hub priority" : name === "tracker" ? "Master tracker for batched cluster" : "Filed by the Autonomy Hub Explorer",
          }),
        });
      }
    } catch { /* */ }
  }
}

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
