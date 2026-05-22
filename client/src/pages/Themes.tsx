import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { DataTable, type Column } from "@/components/data-table";

type ThemeOptimalConfig = {
  theme: string;
  champion_config_id: string | null;
  ids_median: number | null;
  delta_vs_control: number | null;
  promoted_at: string | null;
  thompson_alpha: number | null;
  thompson_beta: number | null;
};

type ThemesResponse = {
  themes: ThemeOptimalConfig[];
  dna_configured: boolean;
};

function fmtNum(n: number | null, digits = 3): string {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

function fmtDelta(n: number | null): string {
  if (n === null || n === undefined) return "—";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(3)}`;
}

function fmtDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

const columns: Column<ThemeOptimalConfig>[] = [
  {
    key: "theme",
    header: "Theme",
    accessor: (t) => t.theme,
    render: (t) => <span className="font-medium">{t.theme}</span>,
  },
  {
    key: "champion_config_id",
    header: "Champion config id",
    accessor: (t) => t.champion_config_id,
    render: (t) => (
      <span className="font-mono text-xs text-muted-foreground">{t.champion_config_id ?? "—"}</span>
    ),
  },
  {
    key: "ids_median",
    header: "IDS median",
    accessor: (t) => t.ids_median,
    align: "right",
    render: (t) => <span className="tabular-nums">{fmtNum(t.ids_median)}</span>,
  },
  {
    key: "delta_vs_control",
    header: "Δ vs control",
    accessor: (t) => t.delta_vs_control,
    align: "right",
    render: (t) => <span className="tabular-nums">{fmtDelta(t.delta_vs_control)}</span>,
  },
  {
    key: "promoted_at",
    header: "Promoted at",
    accessor: (t) => t.promoted_at,
    render: (t) => <span className="text-xs text-muted-foreground">{fmtDate(t.promoted_at)}</span>,
  },
  {
    key: "thompson",
    header: "Thompson α/β",
    accessor: (t) =>
      t.thompson_alpha === null || t.thompson_beta === null
        ? null
        : t.thompson_alpha + t.thompson_beta,
    align: "right",
    render: (t) => (
      <span className="tabular-nums font-mono text-xs">
        {t.thompson_alpha === null || t.thompson_beta === null
          ? "—"
          : `${t.thompson_alpha.toFixed(1)} / ${t.thompson_beta.toFixed(1)}`}
      </span>
    ),
  },
];

export default function Themes() {
  const { data, isLoading, isError, error, refetch } = useQuery<ThemesResponse>({
    queryKey: ["/api/content-platform/themes"],
  });
  const themes = data?.themes ?? [];
  const dnaConfigured = data?.dna_configured ?? false;

  return (
    <Layout
      title="Themes & Champions"
      subtitle={
        dnaConfigured
          ? `${themes.length} themes with champion configs`
          : "DNA service not configured"
      }
    >
      {isLoading ? (
        <Skeleton lines={6} />
      ) : isError ? (
        <ErrorState title="Failed to load themes" error={error} onRetry={() => refetch()} />
      ) : !dnaConfigured ? (
        <EmptyState
          title="Themes not configured"
          description={
            <>
              Set <code className="font-mono">DNA_API_BASE</code> to populate this section.
            </>
          }
        />
      ) : (
        <DataTable
          rows={themes}
          columns={columns}
          rowKey={(t) => t.theme}
          rowHref={(t) => `/themes/${t.theme}`}
          defaultSort={{ key: "ids_median", dir: "desc" }}
          csvFilename="themes"
          emptyMessage="No themes available"
        />
      )}
    </Layout>
  );
}
