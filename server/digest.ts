/**
 * digest.ts — Daily Slack digest builder (AH-10X-05)
 *
 * buildDigestMarkdown() assembles a markdown-formatted overnight summary covering:
 *   1. PRs merged in the last 24h (per configured repos via GitHub API)
 *   2. New draft tasks (top 5 by ev_score)
 *   3. In-flight fleet runs (grouped by kind)
 *   4. Top 10 learning ledger patterns (heat-sorted)
 *   5. Blockers (failed drafts or runs with 3+ amend cycles)
 */

import { storage } from "./storage";

// ─── GitHub PR fetch ──────────────────────────────────────────────────────────

interface MergedPR {
  number: number;
  title: string;
  html_url: string;
  merged_at: string;
  repo: string;
}

async function fetchMergedPRs(repos: string[], token: string): Promise<MergedPR[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const results: MergedPR[] = [];

  for (const repo of repos) {
    if (!repo) continue;
    try {
      const url =
        `https://api.github.com/repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=50`;
      const resp = await fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!resp.ok) continue;
      const prs = (await resp.json()) as any[];
      for (const pr of prs) {
        if (pr.merged_at && pr.merged_at >= since) {
          results.push({
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            merged_at: pr.merged_at,
            repo,
          });
        }
      }
    } catch {
      // best-effort; skip repo on network error
    }
  }

  // sort by merged_at desc
  results.sort((a, b) => b.merged_at.localeCompare(a.merged_at));
  return results;
}

// ─── Digest builder ───────────────────────────────────────────────────────────

export async function buildDigestMarkdown(): Promise<string> {
  const cfg = storage.getCronConfig() as any;
  const token: string | null =
    cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "America/Los_Angeles",
  });

  const lines: string[] = [];

  // ── Header ────────────────────────────────────────────────────────────────
  lines.push(`🌅 *Overnight Autonomy Hub Digest — ${dateLabel}*`);
  lines.push("");

  // ── Section 1: PRs merged in last 24h ────────────────────────────────────
  lines.push("*📦 PRs Merged (last 24h)*");
  if (!token) {
    lines.push("_GitHub token not configured — skipping PR fetch._");
  } else {
    const repos = [
      cfg.default_gh_repo,
      cfg.frontend_gh_repo,
      cfg.hub_gh_repo,
    ].filter(Boolean) as string[];

    const prs = await fetchMergedPRs(repos, token);
    if (prs.length === 0) {
      lines.push("_No PRs merged in the last 24 hours._");
    } else {
      lines.push(`${prs.length} PR${prs.length !== 1 ? "s" : ""} merged:`);
      for (const pr of prs) {
        const repoShort = pr.repo.split("/").pop() ?? pr.repo;
        lines.push(`• [${repoShort}#${pr.number}](${pr.html_url}) — ${pr.title}`);
      }
    }
  }
  lines.push("");

  // ── Section 2: New draft tasks (top 5 by ev_score) ───────────────────────
  lines.push("*📝 Top New Drafts (by EV score)*");
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const allDrafts = storage.listDraftTasks({ status: "proposed" });
  const recentDrafts = allDrafts
    .filter((d) => d.created_at >= since24h)
    .sort((a, b) => (b.ev_score ?? 0) - (a.ev_score ?? 0))
    .slice(0, 5);

  if (recentDrafts.length === 0) {
    lines.push("_No new draft tasks in the last 24 hours._");
  } else {
    for (const d of recentDrafts) {
      const ev = (d.ev_score ?? 0).toFixed(2);
      lines.push(`• [${d.priority.toUpperCase()}] (EV ${ev}) ${d.title}`);
    }
  }
  lines.push("");

  // ── Section 3: In-flight runs (by kind) ──────────────────────────────────
  lines.push("*⚙️ In-Flight Runs*");
  const runningRuns = storage.listFleetRuns({ status: "running", limit: 50 });
  const queuedRuns = storage.listFleetRuns({ status: "queued", limit: 50 });
  const inFlight = [...runningRuns, ...queuedRuns];

  if (inFlight.length === 0) {
    lines.push("_No runs currently in-flight._");
  } else {
    const byKind: Record<string, number> = {};
    for (const r of inFlight) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
    for (const [kind, count] of Object.entries(byKind).sort()) {
      lines.push(`• ${kind}: ${count} run${count !== 1 ? "s" : ""}`);
    }
  }
  lines.push("");

  // ── Section 4: Top 10 ledger patterns (heat-sorted) ──────────────────────
  lines.push("*🧠 Top Learning Ledger Patterns*");
  const ledger = storage.listLedger(10);
  if (ledger.length === 0) {
    lines.push("_Ledger is empty._");
  } else {
    for (const entry of ledger) {
      const heat = entry.heat.toFixed(2);
      const truncated =
        entry.pattern.length > 120
          ? entry.pattern.slice(0, 117) + "…"
          : entry.pattern;
      lines.push(`• [heat ${heat}] ${truncated}`);
    }
  }
  lines.push("");

  // ── Section 5: Blockers ───────────────────────────────────────────────────
  lines.push("*🚧 Blockers*");
  const blockers: string[] = [];

  // Failed draft tasks
  const failedDrafts = storage.listDraftTasks({ status: "dismissed", limit: 20 });
  // We treat dismissed-with-high-ev as blockers
  for (const d of failedDrafts) {
    if ((d.ev_score ?? 0) >= 2) {
      blockers.push(`• Draft #${d.id} dismissed (EV ${(d.ev_score ?? 0).toFixed(2)}): ${d.title}`);
    }
  }

  // Failed fleet runs
  const failedRuns = storage.listFleetRuns({ status: "failed", limit: 30 });
  // Count amend cycles: runs with 3+ ci_cycles approximated by pr_outcomes
  const outcomes = storage.listPrOutcomes(50);
  const highCycleRunIds = new Set(
    outcomes
      .filter((o) => o.ci_cycles >= 3)
      .map((o) => o.run_id),
  );
  for (const r of failedRuns) {
    const isHighCycle = highCycleRunIds.has(r.id);
    if (isHighCycle || (r.started_at >= since24h)) {
      const label = isHighCycle ? " (3+ amend cycles)" : "";
      blockers.push(`• Fleet run #${r.id} (${r.kind}) failed${label}: ${(r.error ?? "unknown error").slice(0, 80)}`);
    }
  }

  if (blockers.length === 0) {
    lines.push("_No blockers detected._");
  } else {
    lines.push(...blockers.slice(0, 10));
  }
  lines.push("");

  // ── Footer ────────────────────────────────────────────────────────────────
  lines.push(`_Generated by Autonomy Hub · <https://momentiq-dna-hub.pplx.app>_`);

  return lines.join("\n");
}
