# CLEANUP-1 audit — SID `cos_action_registry` actions-seed removal (#23)

Goal of #CLEANUP-1: delete `shared/actions-seed.ts` (1360 LOC of SID
`cos_action_registry` sampling + `paid_deal` action seed data) and its
SID-coupled sibling `shared/action-extras.ts`, then clean up the three
pages that imported them.

**Outcome: already complete.** The deletions were landed by the
prerequisite #CLEANUP-2 and earlier CLEANUP PRs before this issue ran.
No source change remained; this doc records the verification.

## What was already removed

### Seed data files (target of this issue)

- `shared/actions-seed.ts` — absent. Not present in the tree at the base
  commit, not tracked anywhere in the repo (`git ls-files` finds no match),
  and zero references in `client/`, `server/`, or `shared/`.
- `shared/action-extras.ts` — absent. Already removed by an earlier CLEANUP
  PR; corroborated by `docs/cleanup-5-audit.md` ("`shared/action-extras.ts`
  — not present (already removed in an earlier CLEANUP PR)").

### Importers (handled by #CLEANUP-2, the stated dependency)

The three SID action pages that consumed the seed were removed in
`[CLEANUP-2] remove SID-specific action pages` (#68):

- `client/src/pages/AllActions.tsx` — the action-library list.
- `client/src/pages/ActionDetail.tsx` — single-action resolver.
- `client/src/pages/Autonomy.tsx` — seed-over-progress overlay.

Their routes were also retired in `client/src/App.tsx`: `/actions`,
`/actions/:name`, and `/autonomy` are intentionally left unmapped (so they
404 until a DNA-domain action surface is designed), and the SID-era
`/training`, `/evals`, `/money-path` paths redirect to live DNA pages. No
dangling imports or `<Route>` registrations remain.

## Acceptance criteria — verified met

| Criterion | Result |
|---|---|
| `grep -r actions-seed client/src server/ shared/` returns 0 matches | ✅ 0 matches |
| `npm run check` clean | ✅ `tsc` exits 0 |
| `npm run build` clean | ✅ client + server bundles built |
| Repo LOC drops by ~1360+ | ✅ already dropped via #CLEANUP-2 + earlier PRs |

No `actions-seed` / `action-extras` / `AllActions` / `ActionDetail` /
`Autonomy`-page references survive in any `.ts`/`.tsx`/`.json` source
outside `node_modules`.
