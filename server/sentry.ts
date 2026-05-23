import type { Express, Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentry(): boolean {
  if (initialized) return true;
  const dsn = (process.env.SENTRY_DSN || "").trim();
  if (!dsn) {
    return false;
  }
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    release: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_SHA || undefined,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0"),
    initialScope: {
      tags: { app: "dna-hub" },
    },
  });
  initialized = true;
  console.log("[sentry] initialized");
  return true;
}

export function sentryRequestHandler() {
  return function (_req: Request, _res: Response, next: NextFunction) {
    next();
  };
}

export function installSentryErrorHandler(app: Express): void {
  if (!initialized) return;
  Sentry.setupExpressErrorHandler(app);
}

export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!initialized) return;
  try {
    if (context) {
      Sentry.withScope((scope) => {
        for (const [k, v] of Object.entries(context)) {
          scope.setExtra(k, v);
        }
        Sentry.captureException(err);
      });
    } else {
      Sentry.captureException(err);
    }
  } catch {
    // never let Sentry itself crash the server
  }
}

export function isSentryInitialized(): boolean {
  return initialized;
}
