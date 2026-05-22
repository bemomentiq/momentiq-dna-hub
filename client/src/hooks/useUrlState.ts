import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

/**
 * Reads and writes a single query-string key inside the hash-router URL.
 *
 * Wouter uses a hash-based router (e.g. `#/ab-runs?status=running`). The query
 * portion lives inside the hash after the first `?`. We parse it, expose the
 * value for the requested key, and provide a setter that updates only that key
 * while preserving other params.
 *
 * - Falls back to `defaultValue` when the key is missing.
 * - Setter calls wouter's `navigate(path)` so SPA routing is preserved (no
 *   full-page reload).
 * - Listens for `hashchange` so external URL edits stay in sync.
 */
export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const [, navigate] = useLocation();

  const read = useCallback((): T => {
    if (typeof window === "undefined") return defaultValue;
    const hash = window.location.hash || "";
    // Strip leading `#`, split path vs query
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    const qIdx = raw.indexOf("?");
    if (qIdx === -1) return defaultValue;
    const params = new URLSearchParams(raw.slice(qIdx + 1));
    const v = params.get(key);
    return (v ?? defaultValue) as T;
  }, [key, defaultValue]);

  const [value, setValue] = useState<T>(read);

  useEffect(() => {
    const onHashChange = () => setValue(read());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [read]);

  const set = useCallback(
    (next: T) => {
      if (typeof window === "undefined") return;
      const hash = window.location.hash || "";
      const raw = hash.startsWith("#") ? hash.slice(1) : hash;
      const qIdx = raw.indexOf("?");
      const path = qIdx === -1 ? raw : raw.slice(0, qIdx);
      const params = new URLSearchParams(qIdx === -1 ? "" : raw.slice(qIdx + 1));
      if (next === "" || next === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, next);
      }
      const qs = params.toString();
      const nextPath = qs ? `${path}?${qs}` : path;
      // wouter's navigate operates on the route path within the hash router
      navigate(nextPath, { replace: false });
      setValue(next);
    },
    [key, defaultValue, navigate],
  );

  return [value, set];
}
