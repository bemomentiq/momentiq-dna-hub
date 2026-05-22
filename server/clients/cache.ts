// Tiny in-process TTL cache for upstream content-platform calls.
// Single-process, no external deps. Negative results (null) get a shorter TTL
// so an upstream blip doesn't sticky a "not configured" response.

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await fn();
  const effectiveTtl = value == null ? Math.min(ttlMs, 10_000) : ttlMs;
  store.set(key, { value, expiresAt: now + effectiveTtl });
  return value;
}

export function cacheBust(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const k of Array.from(store.keys())) {
    if (k.startsWith(prefix)) {
      store.delete(k);
      n++;
    }
  }
  return n;
}

export function cacheStats(): { entries: number; keys: string[] } {
  return { entries: store.size, keys: Array.from(store.keys()) };
}
