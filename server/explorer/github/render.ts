// GitHub issue body renderers (split from github-sync.ts).

import type { DraftTask } from "@shared/schema";
import type { BatchGroup } from "./issues";
import { inferArea, extractPrefix, parseEffortHours } from "./repo-routing";

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
export function parseAgentBriefingSections(briefing: string): Record<string, string> {
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
export function phaseFromPrefix(prefix: string): string {
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
export function groupChildrenByPhase(tasks: DraftTask[]): Phase[] {
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
