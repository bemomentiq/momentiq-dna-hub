import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";
import { queryClient } from "@/lib/queryClient";

const STORAGE_KEY = "dnaHubPollingPaused";

/**
 * Header pill that globally pauses/resumes background polling by flipping the
 * `QueryClient` defaults. When paused we also `invalidateQueries({ refetchType: 'none' })`
 * to drop pending refetches without cancelling the in-flight requests (which is
 * what `cancelQueries()` would do — too aggressive for a UX-level pause).
 *
 * Choice is persisted in localStorage so a paused tab stays paused across reloads.
 */
function applyPaused(paused: boolean) {
  const opts = queryClient.getDefaultOptions();
  if (!opts.queries) opts.queries = {};
  if (paused) {
    opts.queries.refetchOnWindowFocus = false;
    opts.queries.refetchOnReconnect = false;
    opts.queries.refetchInterval = false;
    // Drop pending refetches without cancelling in-flight requests.
    queryClient.invalidateQueries({ refetchType: "none" });
  } else {
    opts.queries.refetchOnWindowFocus = true;
    opts.queries.refetchOnReconnect = true;
    // Do not touch refetchInterval — per-query intervals are owned by callers.
  }
}

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function PollingControl() {
  const [paused, setPaused] = useState<boolean>(() => readInitial());

  // Apply the persisted choice on mount so the QueryClient defaults match
  // the toggle state before any queries run.
  useEffect(() => {
    applyPaused(paused);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = () => {
    const next = !paused;
    setPaused(next);
    applyPaused(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    }
  };

  return (
    <button
      onClick={toggle}
      data-testid="polling-control"
      title={paused ? "Resume background polling" : "Pause background polling"}
      className={cn(
        "inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors",
        paused
          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20"
          : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20",
      )}
    >
      {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
      Polling: {paused ? "PAUSED" : "ON"}
    </button>
  );
}
