// RFC 4180-ish CSV export. Single source of truth so every table exports
// identically. Triggers a browser download.

export type CsvColumn<T> = {
  header: string;
  accessor: (row: T) => unknown;
};

export function exportCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[]): void {
  const lines: string[] = [];
  lines.push(columns.map((c) => csvCell(c.header)).join(","));
  for (const row of rows) {
    lines.push(columns.map((c) => csvCell(c.accessor(row))).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
