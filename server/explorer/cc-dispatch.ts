// CC HTTP dispatch client — the GKE codex-lane path.
//
// Replaces the direct-SSH-to-mini cascade (mini-4 / mini-5), which broke when
// CC migrated off the Mac Minis onto GKE Codex Lanes (gke-codex-lane-1..13).
// Every Hub dispatch now POSTs a task to CC's queue tagged with the DNA
// project id; CC schedules it onto whichever GKE codex-lane currently lists
// that project in its supportedProjectIds.
//
// CC's API is the contract (we do not modify CC). This module wraps three
// calls the Hub needs:
//   postTask(...)       — enqueue a task            (POST /api/tasks)
//   getTaskStatus(...)  — poll a task's state       (GET  /api/tasks/:id)
//   streamRunLog(...)   — fetch a task's run log    (GET  /api/tasks/:id/log)

// CC project whose supportedProjectIds the GKE codex-lanes were registered
// against (per the 2026-05-08 redeploy ledger). Tasks tagged with this id land
// on a gke-codex-lane-* worker. Overridable via env for non-prod CC instances.
export const CC_DNA_PROJECT_ID = Number(process.env.CC_DNA_PROJECT_ID ?? 14920);

// Provider → pinned model. codex lanes run gpt_5_5; claude lanes run Opus.
export type Provider = "codex" | "claude";

export const PROVIDER_MODELS: Record<Provider, string> = {
  codex: "gpt_5_5",
  claude: "claude_opus_4_7",
};

const DEFAULT_SKILLS = ["codex-fleet", "mcc-roadmap-specialist-dna", "vidgen-continuity-ops"];

function ccHeaders(ccApiKey: string): Record<string, string> {
  return { "Content-Type": "application/json", "x-api-key": ccApiKey };
}

export interface PostTaskOpts {
  ccApiUrl: string;
  ccApiKey: string;
  title: string;
  description: string;
  briefing: string;
  repoUrl: string;
  provider?: Provider;
  priority?: string;
  projectSlug?: string;
  projectId?: number;
  relevantSkills?: string[];
  taskType?: string;
}

export interface PostTaskResult {
  ok: boolean;
  ccTaskId?: number;
  model?: string;
  error?: string;
}

/**
 * Enqueue a task on CC for the GKE codex-lane fleet.
 *
 * POSTs to /api/tasks tagged with projectId=CC_DNA_PROJECT_ID. If that route
 * is unavailable on a given CC build (404/405), falls back to the batch
 * endpoint /api/tasks/bulk with a single-element array — both accept the same
 * task shape.
 */
export async function postTask(opts: PostTaskOpts): Promise<PostTaskResult> {
  const provider: Provider = opts.provider ?? "codex";
  const task = {
    title: opts.title,
    description: opts.description,
    projectId: opts.projectId ?? CC_DNA_PROJECT_ID,
    projectSlug: opts.projectSlug ?? "momentiq-dna",
    repoUrl: opts.repoUrl,
    priority: opts.priority ?? "p1",
    taskType: opts.taskType ?? "dev_task",
    automatable: true,
    relevantSkills: opts.relevantSkills ?? DEFAULT_SKILLS,
    effortEstimate: "30 min",
    executor: provider === "claude" ? "pin-claude" : "pin-codex",
    status: "planned",
    agentBriefing: opts.briefing,
  };

  const post = async (path: string, body: unknown) =>
    fetch(`${opts.ccApiUrl}${path}`, {
      method: "POST",
      headers: ccHeaders(opts.ccApiKey),
      body: JSON.stringify(body),
    });

  try {
    let r = await post("/api/tasks", task);
    // Some CC builds only expose the bulk route; fall back transparently.
    if (r.status === 404 || r.status === 405) {
      r = await post("/api/tasks/bulk", [task]);
    }
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `CC ${r.status}: ${text.slice(0, 300)}` };
    const parsed: any = (() => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    })();
    const first = Array.isArray(parsed) ? parsed[0] : parsed?.tasks?.[0] ?? parsed?.created?.[0] ?? parsed?.task ?? parsed;
    const ccTaskId = first?.id ?? first?.taskId ?? null;
    return { ok: true, ccTaskId: ccTaskId ?? undefined, model: PROVIDER_MODELS[provider] };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export interface CcTaskStatus {
  ok: boolean;
  /** CC task lifecycle: planned | queued | running | completed | failed | cancelled | ... */
  status?: string;
  /** Which GKE codex-lane picked it up, e.g. "gke-codex-lane-7". */
  agentId?: string;
  prUrl?: string | null;
  prState?: string | null;
  summary?: string | null;
  logTail?: string | null;
  error?: string;
}

/** GET a CC task's current state. Field names are normalised across CC builds. */
export async function getTaskStatus(opts: {
  ccApiUrl: string;
  ccApiKey: string;
  ccTaskId: number;
}): Promise<CcTaskStatus> {
  try {
    const r = await fetch(`${opts.ccApiUrl}/api/tasks/${opts.ccTaskId}`, {
      headers: ccHeaders(opts.ccApiKey),
    });
    if (!r.ok) return { ok: false, error: `CC ${r.status}: ${(await r.text()).slice(0, 200)}` };
    const t: any = await r.json();
    return {
      ok: true,
      status: t?.status ?? t?.state ?? undefined,
      agentId: t?.agentId ?? t?.assignedAgentId ?? t?.lane ?? t?.assignedLane ?? undefined,
      prUrl: t?.prUrl ?? t?.pr_url ?? null,
      prState: t?.prState ?? t?.pr_state ?? null,
      summary: t?.summary ?? t?.resultSummary ?? null,
      logTail: t?.logTail ?? t?.log_tail ?? t?.lastLog ?? null,
    };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

/**
 * Fetch a CC task's run log (last ~8KB), for the /run live tail.
 *
 * Uses GET /api/tasks/:id/log when available; otherwise degrades gracefully to
 * the status summary so the operator surface still shows progress. (A true SSE
 * upgrade can layer on top of this later without changing callers.)
 */
export async function streamRunLog(opts: {
  ccApiUrl: string;
  ccApiKey: string;
  ccTaskId: number;
}): Promise<{ ok: boolean; log: string; error?: string }> {
  try {
    const r = await fetch(`${opts.ccApiUrl}/api/tasks/${opts.ccTaskId}/log`, {
      headers: ccHeaders(opts.ccApiKey),
    });
    if (!r.ok) {
      const s = await getTaskStatus(opts);
      return { ok: s.ok, log: s.logTail ?? s.summary ?? "", error: s.error };
    }
    const text = await r.text();
    return { ok: true, log: text.slice(-8000) };
  } catch (err: any) {
    return { ok: false, log: "", error: err?.message ?? String(err) };
  }
}
