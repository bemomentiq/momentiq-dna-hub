import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";

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
        <div className="rounded-lg border border-card-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Theme</th>
                <th className="text-left px-4 py-2.5 font-medium">Champion config id</th>
                <th className="text-right px-4 py-2.5 font-medium">IDS median</th>
                <th className="text-right px-4 py-2.5 font-medium">Δ vs control</th>
                <th className="text-left px-4 py-2.5 font-medium">Promoted at</th>
                <th className="text-right px-4 py-2.5 font-medium">Thompson α/β</th>
              </tr>
            </thead>
            <tbody>
              {themes.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    No themes available
                  </td>
                </tr>
              )}
              {themes.map((t) => {
                return (
                  <tr
                    key={t.theme}
                    className="border-t border-card-border hover:bg-accent/30"
                    data-testid={`row-theme-${t.theme}`}
                  >
                    <td className="px-4 py-2.5 font-medium">{t.theme}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                      {t.champion_config_id ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtNum(t.ids_median)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {fmtDelta(t.delta_vs_control)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {fmtDate(t.promoted_at)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-mono text-xs">
                      {t.thompson_alpha === null || t.thompson_beta === null
                        ? "—"
                        : `${t.thompson_alpha.toFixed(1)} / ${t.thompson_beta.toFixed(1)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Layout>
  );
}
