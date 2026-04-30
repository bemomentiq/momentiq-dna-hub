// Shared fluid-loop context builder.
//
// Both the Executor (fleet-routes.ts / buildExecutorBriefing) and the Explorer
// (prompt.ts / buildExplorerPrompt) use the same three context sections:
//
//   pickupSection   — the explicit handoff from the most-recent completed run
//   priorSection    — the last N run summaries (compacted stubs for older ones)
//   ledgerSection   — heat-sorted patterns from the learning ledger
//
// Keeping the logic here means changes to formatting, compaction heuristics, or
// QUEUE_EMPTY phrasing propagate to both agent kinds automatically.

export interface FluidLoopPriorRun {
  id: number;
  started_at: string;
  summary: string;
  next_pickup?: string | null;
  gh_pr_url?: string | null;
  status: string;
}

export interface FluidLoopLedgerEntry {
  pattern: string;
  heat: number;
  seen_count: number;
}

export interface FluidLoopOpts {
  /** 'executor' | 'explorer' — controls label prefixes in the prior section */
  kind: "executor" | "explorer";
  runId: number;
  priorRuns?: FluidLoopPriorRun[];
  ledger?: FluidLoopLedgerEntry[];
  latestPickup?: string | null;
  /** Optional hint for QUEUE_EMPTY back-off text */
  openIssueCount?: number;
}

export interface FluidLoopContext {
  pickupSection: string;
  priorSection: string;
  ledgerSection: string;
}

/**
 * Build the three fluid-loop context strings shared by Executor and Explorer.
 *
 * - pickupSection  wraps the latest next_pickup directive (or a "first run" notice)
 * - priorSection   formats up to 25 prior run summaries; compacted ones show as stubs
 * - ledgerSection  formats up to 20 heat-sorted ledger patterns
 */
export function buildFluidLoopContext(opts: FluidLoopOpts): FluidLoopContext {
  const {
    kind,
    runId,
    priorRuns = [],
    ledger = [],
    latestPickup,
    openIssueCount,
  } = opts;

  const label = kind === "executor" ? "EXEC" : "EXPLORE";

  // ── priorSection ──────────────────────────────────────────────────────────
  const priorSection = priorRuns.length
    ? priorRuns.slice(0, 25).map((p) => {
        const pick =
          p.next_pickup && !p.next_pickup.startsWith("[compacted]")
            ? ` → picked_up_by_next: "${p.next_pickup.slice(0, 120)}"`
            : "";
        const pr = p.gh_pr_url ? ` PR=${p.gh_pr_url}` : "";
        return `- ${label} #${p.id} (${p.started_at}, ${p.status})${pr}: ${(p.summary || "").slice(0, 220)}${pick}`;
      }).join("\n")
    : `(no prior ${kind} runs yet — this is cycle #1)`;

  // ── ledgerSection ─────────────────────────────────────────────────────────
  const ledgerSection = ledger.length
    ? ledger
        .slice(0, 20)
        .map((l) => `- [heat ${l.heat.toFixed(1)} x${l.seen_count}] ${l.pattern}`)
        .join("\n")
    : "(ledger empty — first compounding cycle)";

  // ── pickupSection ─────────────────────────────────────────────────────────
  let pickupSection: string;
  if (!latestPickup) {
    pickupSection =
      "\n### ➤ FIRST RUN — no pickup directive yet; build the plan from scratch.\n";
  } else if (latestPickup.startsWith("QUEUE_EMPTY")) {
    // Back-off: no eligible work right now
    const hint =
      typeof openIssueCount === "number"
        ? ` (current open issue count hint: ${openIssueCount})`
        : "";
    pickupSection =
      `\n### ➤ QUEUE_EMPTY BACK-OFF (from prior run #${runId - 1})${hint}:\n` +
      `${latestPickup}\n` +
      `Re-verify via \`gh issue list\` before assuming the queue is still empty.\n`;
  } else {
    pickupSection =
      `\n### ➤ PICKUP DIRECTIVE FROM PRIOR RUN (this is your explicit handoff — start here):\n` +
      `${latestPickup}\n`;
  }

  return { pickupSection, priorSection, ledgerSection };
}
