import { Layout } from "@/components/Layout";
import { DataTable, type Column } from "@/components/data-table";

type DemoRow = {
  id: string;
  theme: string;
  status: "running" | "completed" | "promoted" | "rejected";
  ids: number | null;
  delta: number | null;
  cost_usd: number;
};

const ROWS: DemoRow[] = Array.from({ length: 25 }).map((_, i) => ({
  id: `run-${100 + i}`,
  theme: ["serum", "ipl", "wrinkle-patch", "scalp-applicator", "hydrogel-mask"][i % 5],
  status: (["running", "completed", "promoted", "rejected"] as const)[i % 4],
  ids: i % 7 === 0 ? null : Number((0.6 + (i % 5) * 0.07).toFixed(3)),
  delta: i % 11 === 0 ? null : Number((-0.05 + (i % 6) * 0.04).toFixed(3)),
  cost_usd: 1.25 + (i % 9) * 3.4,
}));

const columns: Column<DemoRow>[] = [
  { key: "id", header: "Run", accessor: (r) => r.id },
  { key: "theme", header: "Theme", accessor: (r) => r.theme },
  { key: "status", header: "Status", accessor: (r) => r.status },
  {
    key: "ids",
    header: "IDS",
    accessor: (r) => r.ids,
    align: "right",
    render: (r) => (r.ids == null ? "—" : r.ids.toFixed(3)),
  },
  {
    key: "delta",
    header: "Δ vs control",
    accessor: (r) => r.delta,
    align: "right",
    render: (r) => (r.delta == null ? "—" : (r.delta >= 0 ? "+" : "") + r.delta.toFixed(3)),
  },
  {
    key: "cost_usd",
    header: "Veo cost",
    accessor: (r) => r.cost_usd,
    align: "right",
    render: (r) => `$${r.cost_usd.toFixed(2)}`,
  },
];

export default function DataTableDemo() {
  return (
    <Layout title="DataTable demo" subtitle="Sticky header · sort · search · density · column visibility · CSV export">
      <DataTable
        rows={ROWS}
        columns={columns}
        rowKey={(r) => r.id}
        defaultSort={{ key: "ids", dir: "desc" }}
        searchPlaceholder="Search by run id, theme, status…"
        csvFilename="datatable-demo"
      />
    </Layout>
  );
}
