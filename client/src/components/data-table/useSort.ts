import { useCallback, useMemo, useRef, useState } from "react";

export type SortDir = "asc" | "desc";

export function useSort<T>(
  rows: T[],
  accessor: (row: T, key: string) => unknown,
  defaultKey?: string,
  defaultDir: SortDir = "asc",
) {
  const [key, setKey] = useState<string | null>(defaultKey ?? null);
  const [dir, setDir] = useState<SortDir>(defaultDir);

  const keyRef = useRef(key);
  keyRef.current = key;
  const dirRef = useRef(dir);
  dirRef.current = dir;

  const sorted = useMemo(() => {
    if (!key) return rows;
    const out = [...rows];
    out.sort((a, b) => {
      const av = accessor(a, key);
      const bv = accessor(b, key);
      const cmp = compare(av, bv);
      return dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [rows, key, dir, accessor]);

  const toggle = useCallback((k: string) => {
    if (keyRef.current !== k) {
      setKey(k);
      setDir("asc");
      return;
    }
    if (dirRef.current === "asc") {
      setDir("desc");
      return;
    }
    setKey(null);
  }, []);

  const clearSort = useCallback(() => setKey(null), []);

  return { sorted, key, dir, toggle, clearSort };
}

function compare(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}
