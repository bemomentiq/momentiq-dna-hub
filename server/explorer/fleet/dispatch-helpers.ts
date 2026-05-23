// Fleet dispatch helpers (split from fleet-routes.ts).

// ============ Dispatch helper ============

export async function ccDispatch(opts: {
  cc_api_url: string;
  cc_api_key: string;
  title: string;
  description: string;
  projectSlug: string;
  repoUrl: string;
  priority: string;
  executor: string;
  agentBriefing: string;
  relevantSkills: string[];
  taskType?: string;
}): Promise<{ ok: boolean; cc_task_id?: number; error?: string }> {
  const ccTask = {
    title: opts.title,
    description: opts.description,
    projectSlug: opts.projectSlug,
    repoUrl: opts.repoUrl,
    priority: opts.priority,
    taskType: opts.taskType || "dev_task",
    automatable: true,
    relevantSkills: opts.relevantSkills,
    effortEstimate: "30 min",
    executor: opts.executor,
    status: "planned",
    agentBriefing: opts.agentBriefing,
  };
  try {
    const r = await fetch(`${opts.cc_api_url}/api/tasks/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": opts.cc_api_key },
      body: JSON.stringify([ccTask]),
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status}: ${text.slice(0, 300)}` };
    const parsed: any = (() => { try { return JSON.parse(text); } catch { return null; } })();
    const ccTasks: any[] = Array.isArray(parsed) ? parsed : (parsed?.tasks ?? parsed?.created ?? []);
    const ccTaskId = ccTasks[0]?.id ?? ccTasks[0]?.taskId ?? null;
    return { ok: true, cc_task_id: ccTaskId };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// ============ Helper: fetch GitHub context for ad-hoc briefing ============
export async function fetchGhContext(repo: string, token: string | null): Promise<{ recent_prs: { number: number; title: string }[]; open_issues: { number: number; title: string }[] }> {
  if (!token) return { recent_prs: [], open_issues: [] };
  const headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  try {
    const [prsR, issuesR] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}/pulls?state=closed&per_page=10&sort=updated&direction=desc`, { headers }),
      fetch(`https://api.github.com/repos/${repo}/issues?state=open&labels=autonomy-hub&per_page=15`, { headers }),
    ]);
    const prs = prsR.ok ? (await prsR.json()) as any[] : [];
    const issues = issuesR.ok ? (await issuesR.json()) as any[] : [];
    return {
      recent_prs: prs.filter((p) => p.merged_at).slice(0, 10).map((p) => ({ number: p.number, title: p.title })),
      open_issues: issues.filter((i) => !i.pull_request).slice(0, 15).map((i) => ({ number: i.number, title: i.title })),
    };
  } catch {
    return { recent_prs: [], open_issues: [] };
  }
}
