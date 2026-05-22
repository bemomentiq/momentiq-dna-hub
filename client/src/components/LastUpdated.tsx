import { useEffect, useState } from "react";
import { queryClient } from "@/lib/queryClient";

function formatRelative(ts: number): string {
  const diffMs = Date.now() - ts;
  const s = Math.max(0, Math.floor(diffMs / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function computeMostRecent(): number {
  let max = 0;
  for (const q of queryClient.getQueryCache().getAll()) {
    const t = q.state.dataUpdatedAt;
    if (t && t > max) max = t;
  }
  return max;
}

export function LastUpdated() {
  const [latest, setLatest] = useState<number>(() => computeMostRecent());
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      setLatest((prev) => {
        const next = computeMostRecent();
        return next > prev ? next : prev;
      });
    });
    const interval = setInterval(() => setTick((t) => t + 1), 10000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  if (!latest) return null;

  return (
    <span
      className="inline-flex items-center rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
      data-testid="text-last-updated"
      title={new Date(latest).toLocaleString()}
    >
      Updated {formatRelative(latest)}
    </span>
  );
}
