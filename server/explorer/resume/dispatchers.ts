// Per-lane dispatch functions for the auto-resume loop (split from auto-resume.ts).

import { dispatchConsolidationToCC } from "../consolidation";
import { dispatchOrganizerToCC } from "../backlog-organizer";

export const HUB_BASE = process.env.NODE_ENV === "production"
  ? "https://momentiq-dna-hub.pplx.app/port/5000"
  : "http://localhost:5000";

export async function dispatchExplorer(executor: string, fallback: string): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await fetch(`${HUB_BASE}/api/explorer/dispatch-fleet`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      trigger: "auto_resume",
      executor,
      fallback_executor: fallback,
      priority: "p1",
    }),
  });
  if (!r.ok) {
    return { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  const j = (await r.json()) as any;
  return { ok: true, run_id: j?.run?.id };
}

export async function dispatchAudit(executor: string, fallback: string): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await fetch(`${HUB_BASE}/api/audit/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      trigger: "auto_resume",
      executor,
      fallback_executor: fallback,
      priority: "p1",
    }),
  });
  if (!r.ok) {
    return { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  const j = (await r.json()) as any;
  return { ok: true, run_id: j?.run_id };
}

export async function dispatchTestDebug(executor: string, fallback: string): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await fetch(`${HUB_BASE}/api/test-debug/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      trigger: "auto_resume",
      executor,
      fallback_executor: fallback,
      priority: "p2",
    }),
  });
  if (!r.ok) {
    return { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  const j = (await r.json()) as any;
  return { ok: true, run_id: j?.run_id };
}

export async function dispatchExecutor(executor: string, fallback: string): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await fetch(`${HUB_BASE}/api/executor/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
    body: JSON.stringify({
      trigger: "auto_resume",
      executor,
      fallback_executor: fallback,
      priority: "p1",
    }),
  });
  if (!r.ok) {
    return { ok: false, error: `${r.status}: ${(await r.text()).slice(0, 200)}` };
  }
  const j = (await r.json()) as any;
  return { ok: true, run_id: j?.run_id };
}

export async function dispatchConsolidation(): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await dispatchConsolidationToCC();
  return { ok: r.ok, run_id: r.cc_task_id, error: r.error };
}

export async function dispatchOrganizer(): Promise<{ ok: boolean; run_id?: number; error?: string }> {
  const r = await dispatchOrganizerToCC({ kind: "full_backlog" });
  return { ok: r.ok, run_id: r.cc_task_id, error: r.error };
}
