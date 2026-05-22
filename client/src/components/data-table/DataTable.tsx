import { ReactNode, useCallback, useMemo, useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Download, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useSort } from "./useSort";
import { useSearch } from "./useSearch";
import { exportCsv } from "./exportCsv";

export type Column<T> = {
  key: string;
  header: string;
  accessor: (row: T) => unknown;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
  sortable?: boolean;
  searchable?: boolean;
  defaultVisible?: boolean;
  className?: string;
};

export type DataTableProps<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  density?: "compact" | "cozy";
  searchPlaceholder?: string;
  csvFilename?: string;
  toolbar?: ReactNode;
  emptyMessage?: string;
};

type Density = "compact" | "cozy";

const INTERACTIVE_SELECTORS = "a, button, input, select, textarea, [role='button']";

function densityFromStorage(fallback: Density): Density {
  if (typeof window === "undefined") return fallback;
  const v = window.localStorage.getItem("dnaHubTableDensity");
  return v === "compact" || v === "cozy" ? v : fallback;
}

function visibleColsFromStorage(key: string, allKeys: string[], defaultHidden: Set<string>): Set<string> {
  if (typeof window === "undefined") return new Set(allKeys.filter((k) => !defaultHidden.has(k)));
  const raw = window.localStorage.getItem(`dnaHubTableCols:${key}`);
  if (!raw) return new Set(allKeys.filter((k) => !defaultHidden.has(k)));
  try {
    const arr = JSON.parse(raw) as string[];
    const saved = new Set(arr.filter((k) => allKeys.includes(k)));
    // Merge in new columns that weren't in the saved set (Bug 3 fix)
    const savedKeys = new Set(arr);
    for (const k of allKeys) {
      if (!savedKeys.has(k) && !defaultHidden.has(k)) {
        saved.add(k);
      }
    }
    return saved;
  } catch {
    return new Set(allKeys.filter((k) => !defaultHidden.has(k)));
  }
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    rows,
    columns,
    rowKey,
    rowHref,
    defaultSort,
    density: densityProp,
    searchPlaceholder = "Search…",
    csvFilename,
    toolbar,
    emptyMessage = "No data",
  } = props;

  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");

  const storageKey = csvFilename ?? columns.map((c) => c.key).join(",");
  const allKeys = columns.map((c) => c.key);
  const defaultHidden = new Set(columns.filter((c) => c.defaultVisible === false).map((c) => c.key));

  const [density, setDensity] = useState<Density>(() => densityFromStorage(densityProp ?? "cozy"));
  const [visible, setVisible] = useState<Set<string>>(() => visibleColsFromStorage(storageKey, allKeys, defaultHidden));

  // Bug 7 fix: re-sync visible state when storageKey changes
  const prevStorageKey = useRef(storageKey);
  useEffect(() => {
    if (prevStorageKey.current !== storageKey) {
      prevStorageKey.current = storageKey;
      setVisible(visibleColsFromStorage(storageKey, allKeys, defaultHidden));
    }
  });

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem("dnaHubTableDensity", density);
  }, [density]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(`dnaHubTableCols:${storageKey}`, JSON.stringify(Array.from(visible)));
    }
  }, [visible, storageKey]);

  const colByKey = useMemo(() => {
    const m = new Map<string, Column<T>>();
    columns.forEach((c) => m.set(c.key, c));
    return m;
  }, [columns]);

  const sortAccessor = useCallback(
    (row: T, key: string) => {
      const col = colByKey.get(key);
      return col ? col.accessor(row) : null;
    },
    [colByKey],
  );

  // Bug 6 fix: only apply defaultSort if the target column is sortable
  const validDefaultSortKey = useMemo(() => {
    if (!defaultSort?.key) return undefined;
    const col = columns.find((c) => c.key === defaultSort.key);
    if (col && col.sortable === false) return undefined;
    return defaultSort.key;
  }, [defaultSort?.key, columns]);

  const { sorted, key: sortKey, dir: sortDir, toggle, clearSort } = useSort(rows, sortAccessor, validDefaultSortKey, defaultSort?.dir ?? "asc");

  // Bug 4 fix: reset sort when sorted column becomes hidden
  useEffect(() => {
    if (sortKey && !visible.has(sortKey)) {
      clearSort();
    }
  }, [visible, sortKey, clearSort]);

  const searchAccessors = useMemo(
    () => columns.filter((c) => c.searchable !== false).map((c) => c.accessor),
    [columns],
  );
  const filtered = useSearch(sorted, query, searchAccessors);

  const visibleColumns = columns.filter((c) => visible.has(c.key));

  const onExport = () => {
    if (!csvFilename) return;
    exportCsv(
      csvFilename,
      filtered,
      visibleColumns.map((c) => ({ header: c.header, accessor: c.accessor })),
    );
  };

  const rowPaddingY = density === "compact" ? "py-1" : "py-2";
  const cellPx = "px-3";

  return (
    <div className="rounded-lg border border-card-border bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-card-border p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="flex-1 min-w-[160px] h-8 text-sm px-2 bg-background border border-input rounded-md focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {toolbar}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setDensity((d) => (d === "cozy" ? "compact" : "cozy"))}
          aria-label="Toggle table density"
        >
          {density === "cozy" ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" aria-label="Toggle column visibility">
              <Columns3 className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((c) => (
              <DropdownMenuCheckboxItem
                key={c.key}
                checked={visible.has(c.key)}
                disabled={visible.has(c.key) && visible.size === 1}
                onCheckedChange={(checked) => {
                  setVisible((prev) => {
                    const next = new Set(prev);
                    if (checked) {
                      next.add(c.key);
                    } else {
                      if (next.size <= 1) return prev;
                      next.delete(c.key);
                    }
                    return next;
                  });
                }}
              >
                {c.header}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {csvFilename && (
          <Button variant="ghost" size="sm" onClick={onExport} aria-label="Export CSV">
            <Download className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/40 backdrop-blur text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {visibleColumns.map((c) => {
                const sortable = c.sortable !== false;
                const isSorted = sortKey === c.key;
                const align = c.align === "right" ? "text-right" : "text-left";
                return (
                  <th
                    key={c.key}
                    className={cn(cellPx, "py-2 font-medium", align, c.className)}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        className={cn(
                          "inline-flex items-center gap-1",
                          c.align === "right" && "flex-row-reverse",
                          "hover:text-foreground transition-colors",
                        )}
                      >
                        {c.header}
                        {isSorted ? (
                          sortDir === "asc" ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length || 1}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  {query.trim() ? "No results found" : emptyMessage}
                </td>
              </tr>
            )}
            {filtered.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  onClick={
                    href
                      ? (e) => {
                          const target = e.target as HTMLElement;
                          if (target.closest(INTERACTIVE_SELECTORS)) return;
                          navigate(href);
                        }
                      : undefined
                  }
                  className={cn(
                    "border-t border-card-border",
                    href && "cursor-pointer hover:bg-muted/40",
                  )}
                >
                  {visibleColumns.map((c) => {
                    const align = c.align === "right" ? "text-right" : "text-left";
                    return (
                      <td
                        key={c.key}
                        className={cn(cellPx, rowPaddingY, align, c.className)}
                      >
                        {c.render ? c.render(row) : String(c.accessor(row) ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
