import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { isSentryInitialized } from "./sentry";

const BOOT_TIME_MS = Date.now();

function readVersion(): string {
  return (
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.GIT_SHA ||
    process.env.npm_package_version ||
    "unknown"
  );
}

function pingDb(): { ok: boolean; error?: string } {
  try {
    const sqlite = storage.getDb();
    const row = sqlite.prepare("SELECT 1 as ok").get() as { ok: number } | undefined;
    if (!row || row.ok !== 1) return { ok: false, error: "unexpected result" };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req: Request, res: Response) => {
    const dbCheck = pingDb();
    const ok = dbCheck.ok;
    const uptimeS = Math.round((Date.now() - BOOT_TIME_MS) / 1000);
    res.status(ok ? 200 : 503).json({
      ok,
      db_ok: dbCheck.ok,
      db_error: dbCheck.error ?? null,
      sentry_enabled: isSentryInitialized(),
      auth_enabled: !!(process.env.HUB_TOKEN || "").trim(),
      version: readVersion(),
      uptime_s: uptimeS,
      timestamp: new Date().toISOString(),
    });
  });
}
