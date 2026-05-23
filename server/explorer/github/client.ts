// GitHub API client primitives (split from github-sync.ts).

import { storage } from "../../storage";

export async function resolveToken(): Promise<string> {
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

export async function resolveApiHost(): Promise<string> {
  if (process.env.GH_HOST && process.env.GH_HOST !== "github.com") {
    return `https://${process.env.GH_HOST}/api/v3`;
  }
  return `https://api.github.com`;
}

export async function ghFetch(path: string, init: RequestInit = {}): Promise<Response> {
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

export async function ensureLabels(repo: string, labels: string[]) {
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
