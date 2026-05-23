# DNA Hub — Operator Runbook

Production URL: https://momentiq-dna-hub-2.pplx.app
Repo: https://github.com/bemomentiq/momentiq-dna-hub
Host: Railway (project `momentiq-dna-hub`)
Owner / on-call: `@alex` (`alex@bemomentiq.com`)

This is the incident-response playbook. Keep it short, keep it current.
If you change behavior or wire a new dashboard, update the relevant
section in the same PR.

---

## 1. Dashboards & links

| What | Where |
|---|---|
| Production app | https://momentiq-dna-hub-2.pplx.app |
| Railway dashboard | https://railway.app (project: `momentiq-dna-hub`) |
| Sentry project | https://sentry.io (project tag: `app:dna-hub`) |
| GitHub repo | https://github.com/bemomentiq/momentiq-dna-hub |
| Health check | https://momentiq-dna-hub-2.pplx.app/api/health |

---

## 2. Required env vars

These MUST be set on Railway before `npm start` will be useful in
production. The boot path logs a warning for any missing one and the
relevant API surface degrades.

| Var | Purpose | Required |
|---|---|---|
| `HUB_TOKEN` | Shared secret enforced on `/api/*` via `X-Hub-Token` header | yes (prod) |
| `GH_PAT` | GitHub PAT (fine-grained or classic). `GH_TOKEN` / `GITHUB_TOKEN` also accepted | yes |
| `SENTRY_DSN` | Sentry project DSN. Without it, error capture is a no-op. | recommended |
| `DATABASE_URL` | Postgres URL. If unset, local sqlite (`data.db`) is used. | optional |
| `SLACK_WEBHOOK_URL` | Nightly digest sink. | optional |
| `DNA_API_BASE` | `momentiq-dna` service base URL | optional |
| `SCRIPTSAGE_API_BASE` | `momentiq-scriptsage-backend` base URL | optional |

Rotation procedure for any of these:
1. Generate / mint the new value.
2. Update it in the Railway dashboard (Project → Variables).
3. Trigger a redeploy (Railway re-deploys on env change automatically;
   confirm via the deploy log).
4. Hit `/api/health` to confirm the service is up.
5. For `HUB_TOKEN`: update any operator clients (curl scripts, browser
   bookmarklet) with the new value.

---

## 3. Deploy

Deploys are git-push driven via Railway's GitHub integration.

```bash
# normal deploy
git push origin main   # Railway watches main, auto-builds + ships
```

The build pipeline is `tsx script/build.ts` (server bundle to
`dist/index.cjs` + Vite client build). `npm start` runs the production
node entrypoint.

Smoke test after deploy:
```bash
curl -sS https://momentiq-dna-hub-2.pplx.app/api/health | jq
# expect: {"ok":true,"db_ok":true,"version":"<sha>","uptime_s":<small>,...}

curl -sS -o /dev/null -w "%{http_code}\n" https://momentiq-dna-hub-2.pplx.app/api/autonomy/queue
# expect: 401  (auth gate working)

curl -sS -H "X-Hub-Token: $HUB_TOKEN" https://momentiq-dna-hub-2.pplx.app/api/autonomy/queue | jq '. | length'
# expect: a non-negative integer
```

---

## 4. Rollback

If a deploy is bad:

1. **Railway dashboard → Deployments → previous green build → "Redeploy"**.
   This is the fastest path. Railway keeps recent build artifacts.
2. If the dashboard is unavailable, revert in git:
   ```bash
   git revert <bad-sha>
   git push origin main
   ```
3. After rollback, verify `/api/health` and the dashboard route
   you suspected to be broken.

If a rollback is hot (paging) and you cannot determine the bad commit:
roll back to the most recent deploy that pre-dates the incident's
first Sentry spike.

---

## 5. Common errors & first response

### 5a. `/api/health` returns 503

`db_ok: false` in the body. The sqlite file is corrupted, missing, or
the Postgres URL is unreachable.

- Check Railway logs for the most recent boot — `[storage]` /
  `ensureSchema()` errors will be at the top.
- If sqlite: the volume may have detached. Redeploy; Railway will
  re-mount.
- If Postgres: confirm `DATABASE_URL` is set and the database is
  reachable (`psql $DATABASE_URL -c "SELECT 1"` from a sandbox).

### 5b. All `/api/*` returning 401

Either `HUB_TOKEN` was rotated and clients haven't picked it up, or the
header isn't being sent. Check:
```bash
curl -v -H "X-Hub-Token: <token>" https://momentiq-dna-hub-2.pplx.app/api/autonomy/queue 2>&1 | grep -i hub-token
```
If you see the header echoed but still get 401, the env var is out of
sync — re-set `HUB_TOKEN` in Railway and redeploy.

### 5c. GitHub-backed routes returning 400 `"GitHub token not configured"`

`GH_PAT` is missing or invalid. Set it via Railway Variables or the
`Settings → GitHub PAT` page in the dashboard (which writes it to
`cron_config.github_token`).

### 5d. Spike of 5xx in Sentry

1. Open Sentry → project tag `app:dna-hub` → sort by `lastSeen`.
2. Group by route. The Express error handler tags each event with the
   request path.
3. If it's a single bad upstream (DNA / ScriptSage): bust the affected
   cache (`POST /api/content-platform/cache/bust?prefix=<name>`) and
   confirm the upstream is healthy.
4. If it's a code regression: rollback per §4.

### 5e. Webhook flood / runaway autonomy loop

If a cron lane or PR-babysitter is misbehaving and burning CC tasks:
```bash
# disable cron via the autonomy page, OR directly:
curl -X POST -H "X-Hub-Token: $HUB_TOKEN" \
  https://momentiq-dna-hub-2.pplx.app/api/cron-config \
  -H "Content-Type: application/json" \
  -d '{"enabled":0,"auto_resume_explorer":0,"auto_resume_executor":0}'
```

---

## 6. On-call escalation

| Severity | Definition | Response |
|---|---|---|
| **SEV-1** | Production down (5xx > 50%, /api/health 503 for >5 min) | Page `@alex` immediately. Roll back per §4. |
| **SEV-2** | Partial outage (single section broken, autonomy lane stuck) | Slack `#momentiq-eng` within 30 min. |
| **SEV-3** | Degraded but functional (slow page loads, occasional 5xx) | File a GitHub issue with `severity:sev-3` label. |

Slack: `#momentiq-eng` for engineering, `#momentiq-ops` for ops/business.
Email: `alex@bemomentiq.com`.

---

## 7. Common operator tasks

### Cache bust
```bash
curl -X POST -H "X-Hub-Token: $HUB_TOKEN" \
  https://momentiq-dna-hub-2.pplx.app/api/content-platform/cache/bust
```

### Tail Railway logs
Use the Railway dashboard → Deployments → "View Logs". Filter by
`level=error` for fast triage.

### Trigger digest manually
```bash
curl -X POST -H "X-Hub-Token: $HUB_TOKEN" \
  https://momentiq-dna-hub-2.pplx.app/api/digest/post
```

### Dispatch consolidation manually
```bash
curl -X POST -H "X-Hub-Token: $HUB_TOKEN" \
  https://momentiq-dna-hub-2.pplx.app/api/consolidation/dispatch-now
```

---

## 8. Security notes

- `HUB_TOKEN` is the only thing standing between an attacker and full
  dispatch + cron-config write access. Rotate quarterly, and any time
  it's suspected to have leaked (e.g. shared in a screenshot).
- The PR-babysitter webhook (`/api/pr-babysitter/webhook`) bypasses
  `X-Hub-Token` because GitHub's webhook delivery cannot set custom
  headers. It is HMAC-verified against `cron_config.gh_webhook_secret`
  — make sure that secret is set in production (default `dev-bypass`
  must be changed before any real traffic).
- The GitHub PAT is stored in `cron_config.github_token` (sqlite) and
  optionally seeded from `GH_PAT`. It is NEVER returned by
  `/api/cron-config`; the safe variant only exposes a `has_github_token`
  boolean and the last 4 chars.

---

## 9. Change log

Update this section when you make material changes to the runbook.

- 2026-05-23 — Initial runbook (DNA-11): added auth, Sentry, /api/health.
