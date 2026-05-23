import type { Request, Response, NextFunction } from "express";

const HEADER_NAME = "x-hub-token";

const AUTH_EXEMPT_PREFIXES: string[] = [
  "/api/health",
  "/api/pr-babysitter/webhook",
];

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

let warnedNoToken = false;

export function hubAuth() {
  return function hubAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!req.path.startsWith("/api/")) return next();

    for (const prefix of AUTH_EXEMPT_PREFIXES) {
      if (req.path === prefix || req.path.startsWith(prefix + "/")) return next();
    }

    const expected = (process.env.HUB_TOKEN || "").trim();

    if (!expected) {
      if (!warnedNoToken) {
        warnedNoToken = true;
        console.warn(
          "[auth] HUB_TOKEN env var not set — /api/* is UNAUTHENTICATED. " +
            "Set HUB_TOKEN in production.",
        );
      }
      return next();
    }

    const headerVal = req.header(HEADER_NAME);
    const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;

    if (!provided || !constantTimeEqual(String(provided).trim(), expected)) {
      return void res.status(401).json({ error: "unauthorized", hint: `missing or invalid X-Hub-Token header` });
    }
    return next();
  };
}
