import type { Express } from "express";
import { storage } from "../storage";
import { ALLOWED_REPOS, filterAllowedRepos } from "@shared/allowed-repos";

export function registerGithubRoutes(app: Express) {
  // Live GitHub issues — pulls from both configured target repos.
  // Replaces the old static action-linked-issues view. Returns issues with their
  // full label set + state + recent comments count + linked PR if any.
  app.get("/api/gh-issues", async (req, res) => {
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      // Fail soft: degrade to an empty 200 (mirrors the dna_configured/
      // scriptsage_configured pattern) so unconfigured environments — e.g. CI
      // with no PAT — render an empty state instead of spewing a console 400.
      return void res.json({
        issues: [],
        repos: [],
        errors: ["GitHub token not configured"],
        configured: false,
        fetched_at: new Date().toISOString(),
      });
    }
    // DNA-9: the planning surface (Issues) is locked to the DNA allow-list.
    // Configured repos are merged in but filtered down to ALLOWED_REPOS and
    // deduped, so off-scope repos (e.g. scriptsage) never surface here.
    const repos = filterAllowedRepos([cfg.default_gh_repo, cfg.frontend_gh_repo, cfg.hub_gh_repo, ...ALLOWED_REPOS]);
    const state = (req.query.state as string) || "open";
    const labels = (req.query.labels as string) || ""; // comma-sep, default = all
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    type Issue = {
      number: number; title: string; state: string; created_at: string; updated_at: string;
      author: string | null; labels: string[]; comments: number; pr_url: string | null;
      body_excerpt: string; html_url: string; repo: string;
    };
    const all: Issue[] = [];
    const errors: string[] = [];

    for (const repo of repos) {
      try {
        const params = new URLSearchParams({
          state,
          per_page: "100",
          sort: "updated",
          direction: "desc",
        });
        if (labels) params.set("labels", labels);
        const r = await fetch(`https://api.github.com/repos/${repo}/issues?${params}`, { headers });
        if (!r.ok) {
          errors.push(`${repo} ${r.status}`);
          continue;
        }
        const items = (await r.json()) as any[];
        for (const i of items) {
          if (i.pull_request) continue; // GH /issues includes PRs; filter them
          all.push({
            number: i.number,
            title: i.title,
            state: i.state,
            created_at: i.created_at,
            updated_at: i.updated_at,
            author: i.user?.login ?? null,
            labels: (i.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean),
            comments: i.comments ?? 0,
            pr_url: i.pull_request?.html_url ?? null,
            body_excerpt: (i.body || "").slice(0, 240),
            html_url: i.html_url,
            repo,
          });
        }
      } catch (err: any) {
        errors.push(`${repo}: ${err?.message ?? err}`);
      }
    }
    // Sort by updated_at desc across both repos
    all.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    res.json({ issues: all, repos, errors, fetched_at: new Date().toISOString() });
  });

  // Live roadmap: GitHub milestones + epic:* labelled issues across the DNA
  // allow-list repos (DNA-9 — planning surface locked to ALLOWED_REPOS).
  // Groups issues by epic:* label; non-fatal per-repo errors are surfaced in `errors`.
  app.get("/api/content-platform/roadmap", async (_req, res) => {
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      // Fail soft: degrade to an empty 200 (see /api/gh-issues) so the Roadmap
      // surface renders its "token not configured" hint without a console 400.
      return void res.json({
        milestones: [],
        epics: [],
        repos: [],
        errors: ["GitHub token not configured"],
        configured: false,
        fetched_at: new Date().toISOString(),
      });
    }
    const repos: string[] = [...ALLOWED_REPOS];
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };

    type Milestone = {
      repo: string;
      number: number;
      title: string;
      description: string | null;
      state: string;
      open_issues: number;
      closed_issues: number;
      due_on: string | null;
      html_url: string;
    };
    type EpicIssue = {
      repo: string;
      number: number;
      title: string;
      state: string;
      html_url: string;
      labels: string[];
      updated_at: string;
    };
    type EpicGroup = {
      label: string;
      title: string;
      description: string;
      open: number;
      closed: number;
      total: number;
      issues: EpicIssue[];
      html_url: string;
    };

    const milestones: Milestone[] = [];
    const epicMap = new Map<string, EpicGroup>();
    const errors: string[] = [];

    for (const repo of repos) {
      // Milestones (open + closed)
      try {
        const r = await fetch(
          `https://api.github.com/repos/${repo}/milestones?state=all&per_page=100&sort=due_on&direction=asc`,
          { headers },
        );
        if (!r.ok) {
          errors.push(`${repo} milestones ${r.status}`);
        } else {
          const items = (await r.json()) as any[];
          for (const m of items) {
            milestones.push({
              repo,
              number: m.number,
              title: m.title,
              description: m.description ?? null,
              state: m.state,
              open_issues: m.open_issues ?? 0,
              closed_issues: m.closed_issues ?? 0,
              due_on: m.due_on ?? null,
              html_url: m.html_url,
            });
          }
        }
      } catch (err: any) {
        errors.push(`${repo} milestones: ${err?.message ?? err}`);
      }

      // Epic-labelled issues: discover epic:* labels per-repo, then query issues
      // server-side by label so groups aren't truncated to the latest 100.
      const epicLabelsForRepo: string[] = [];
      try {
        for (let page = 1; page <= 5; page++) {
          const r = await fetch(
            `https://api.github.com/repos/${repo}/labels?per_page=100&page=${page}`,
            { headers },
          );
          if (!r.ok) {
            errors.push(`${repo} labels ${r.status}`);
            break;
          }
          const items = (await r.json()) as any[];
          if (!items.length) break;
          for (const l of items) {
            const name: string | undefined = l?.name;
            if (name && name.startsWith("epic:")) epicLabelsForRepo.push(name);
          }
          if (items.length < 100) break;
        }
      } catch (err: any) {
        errors.push(`${repo} labels: ${err?.message ?? err}`);
      }

      // Dedupe per (repo, number) in case an issue carries multiple epic labels
      // and the API returns it for each label query.
      const seen = new Set<string>();
      for (const epicLabel of epicLabelsForRepo) {
        try {
          for (let page = 1; page <= 5; page++) {
            const params = new URLSearchParams({
              labels: epicLabel,
              state: "all",
              per_page: "100",
              page: String(page),
            });
            const r = await fetch(
              `https://api.github.com/repos/${repo}/issues?${params}`,
              { headers },
            );
            if (!r.ok) {
              errors.push(`${repo} issues label=${epicLabel} ${r.status}`);
              break;
            }
            const items = (await r.json()) as any[];
            if (!items.length) break;
            for (const i of items) {
              if (i.pull_request) continue;
              const labels: string[] = (i.labels || [])
                .map((l: any) => (typeof l === "string" ? l : l.name))
                .filter(Boolean);
              const issueEpicLabels = labels.filter((l) => l.startsWith("epic:"));
              if (issueEpicLabels.length === 0) continue;
              for (const el of issueEpicLabels) {
                const dedupeKey = `${repo}#${i.number}@${el}`;
                if (seen.has(dedupeKey)) continue;
                seen.add(dedupeKey);
                let group = epicMap.get(el);
                if (!group) {
                  group = {
                    label: el,
                    title: el
                      .slice(5)
                      .split(/[-_]/)
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" "),
                    description: "",
                    open: 0,
                    closed: 0,
                    total: 0,
                    issues: [],
                    html_url: `https://github.com/search?q=label%3A%22${encodeURIComponent(el)}%22+org%3Abemomentiq&type=issues`,
                  };
                  epicMap.set(el, group);
                }
                if (i.state === "open") group.open += 1;
                else group.closed += 1;
                group.total += 1;
                group.issues.push({
                  repo,
                  number: i.number,
                  title: i.title,
                  state: i.state,
                  html_url: i.html_url,
                  labels,
                  updated_at: i.updated_at,
                });
              }
            }
            if (items.length < 100) break;
          }
        } catch (err: any) {
          errors.push(`${repo} issues label=${epicLabel}: ${err?.message ?? err}`);
        }
      }
    }

    const epics = Array.from(epicMap.values())
      .map((e) => ({
        ...e,
        issues: e.issues.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))
      .sort((a, b) => b.total - a.total);

    milestones.sort((a, b) => {
      if (a.state !== b.state) return a.state === "open" ? -1 : 1;
      const ad = a.due_on ?? "9999";
      const bd = b.due_on ?? "9999";
      return ad.localeCompare(bd);
    });

    res.json({ milestones, epics, repos, errors, fetched_at: new Date().toISOString() });
  });

  // GET /api/autonomy/recent-prs — last 10 merged PRs across the 3 configured repos (cached 60s)
  let recentPrsCache: { data: any[]; fetched_at: number } | null = null;
  app.get("/api/autonomy/recent-prs", async (_req, res) => {
    const now = Date.now();
    if (recentPrsCache && now - recentPrsCache.fetched_at < 60_000) {
      return void res.json({ prs: recentPrsCache.data, fetched_at: new Date(recentPrsCache.fetched_at).toISOString(), cached: true });
    }
    const cfg = storage.getCronConfig() as any;
    const token = cfg.github_token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
    if (!token || String(token).length < 10) {
      return void res.status(400).json({ error: "GitHub token not configured" });
    }
    const repos = [
      cfg.default_gh_repo,
      cfg.frontend_gh_repo,
      cfg.hub_gh_repo,
    ].filter(Boolean);
    const headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const allPrs: any[] = [];
    const errors: string[] = [];
    for (const repo of repos) {
      try {
        const params = new URLSearchParams({
          state: "closed",
          per_page: "20",
          sort: "updated",
          direction: "desc",
        });
        const r = await fetch(`https://api.github.com/repos/${repo}/pulls?${params}`, { headers });
        if (!r.ok) {
          errors.push(`${repo} ${r.status}`);
          continue;
        }
        const items = (await r.json()) as any[];
        for (const pr of items) {
          if (!pr.merged_at) continue; // only merged PRs
          allPrs.push({
            number: pr.number,
            title: pr.title,
            repo,
            merged_at: pr.merged_at,
            html_url: pr.html_url,
            author: pr.user?.login ?? null,
            labels: (pr.labels || []).map((l: any) => (typeof l === "string" ? l : l.name)).filter(Boolean),
          });
        }
      } catch (err: any) {
        errors.push(`${repo}: ${err?.message ?? err}`);
      }
    }
    allPrs.sort((a, b) => b.merged_at.localeCompare(a.merged_at));
    const top10 = allPrs.slice(0, 10);
    recentPrsCache = { data: top10, fetched_at: now };
    res.json({ prs: top10, repos, errors, fetched_at: new Date().toISOString(), cached: false });
  });

  // ============ Dynamic roadmap ============
  // Merges the hardcoded baseline phases with the live draft_tasks state
  // so the roadmap auto-reflects merged-PR progress without manual edits.
  app.get("/api/roadmap/dynamic", (_req, res) => {
    const drafts = storage.listDraftTasks({ limit: 500 });
    // Group drafts by area into ad-hoc "phases" (one phase per area).
    const byArea = new Map<string, any[]>();
    for (const d of drafts) {
      const a = (d as any).area || "general";
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a)!.push(d);
    }
    const phases: any[] = [];
    for (const [area, items] of Array.from(byArea.entries())) {
      const shipped = items.filter((i: any) => i.status === "shipped").length;
      const total = items.length;
      const pct = total ? Math.round((shipped / total) * 100) : 0;
      phases.push({
        id: `area-${area}`,
        name: `${area.toUpperCase()} — ${shipped}/${total} shipped (${pct}%)`,
        description: `Live roadmap slice for area:${area}, auto-derived from explorer drafts + reconciled GitHub state.`,
        progress_pct: pct,
        items: items.slice(0, 50).map((i: any) => ({
          id: (i as any).gh_issue_number ? `${(i as any).gh_repo}#${(i as any).gh_issue_number}` : `local-${i.id}`,
          title: i.title,
          status: i.status,
          priority: i.priority,
          repo: (i as any).gh_repo || (i.repo_url || "").replace("https://github.com/", ""),
          issue: (i as any).gh_issue_number,
          url: (i as any).gh_issue_url,
        })),
      });
    }
    phases.sort((a, b) => (a.progress_pct - b.progress_pct));
    res.json({
      phases,
      totals: {
        drafts_total: drafts.length,
        drafts_shipped: drafts.filter((d) => d.status === "shipped").length,
        drafts_in_flight: drafts.filter((d) => d.status === "in_flight" || d.status === "queued").length,
        drafts_proposed: drafts.filter((d) => d.status === "proposed").length,
      },
    });
  });
}
