import { useMemo } from "react";

export function useSearch<T>(
  rows: T[],
  query: string,
  accessors: ((row: T) => unknown)[],
) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      accessors.some((accessor) => {
        const v = accessor(row);
        if (v == null) return false;
        return String(v).toLowerCase().includes(q);
      }),
    );
  }, [rows, query, accessors]);
}
