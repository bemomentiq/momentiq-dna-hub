import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { StatCard } from "@/components/StatCard";
import { Sparkline } from "@/components/Sparkline";
import { DataTable, type Column } from "@/components/data-table";
import { useUrlState } from "@/hooks/useUrlState";
import { cn } from "@/lib/utils";

// Inline types — bandit endpoints land in PR A; keeping them client-local
// avoids importing across the server boundary.
type BanditArmState = {
  arm_id: string;
  theme: string | null;
  alpha: number;
  beta: number;
  mean: number;
  samples: number;
  last_updated_at: string | null;
};

type BanditStateResponse = {
  dna_configured: boolean;
  arms: BanditArmState[];
  total_decisions: number;
  exploration_ratio: number | null;
  computed_at: string | null;
  fetched_at: string;
};

type BanditLearningResponse = {
  dna_configured: boolean;
  regret_7d: number | null;
  regret_30d: number | null;
  win_rate_7d: number | null;
  convergence_score: number | null;
  computed_at: string | null;
  fetched_at: string;
};

type BanditRegretPoint = {
  ts: string;
  cumulative_regret: number;
  arm_id: string | null;
};

type BanditRegretResponse = {
  dna_configured: boolean;
  points: BanditRegretPoint[];
  window_days: number;
  fetched_at: string;
};

const WINDOW_OPTIONS = [7, 14, 30] as const;
type WindowOption = (typeof WINDOW_OPTIONS)[number];

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRelative(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const deltaMs = Date.now() - d.getTime();
  const secs = Math.round(deltaMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const columns: Column<BanditArmState>[] = [
  {
    key: "arm_id",
    header: "Arm",
    accessor: (r) => r.arm_id,
    render: (r) => <span className="font-mono text-[11px]">{r.arm_id}</span>,
  },
  {
    key: "theme",
    header: "Theme",
    accessor: (r) => r.theme ?? "",
    render: (r) => <span>{r.theme ?? "—"}</span>,
  },
  {
    key: "alpha",
    header: "α",
    accessor: (r) => r.alpha,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtNum(r.alpha)}</span>,
  },
  {
    key: "beta",
    header: "β",
    accessor: (r) => r.beta,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtNum(r.beta)}</span>,
  },
  {
    key: "mean",
    header: "Mean",
    accessor: (r) => r.mean,
    align: "right",
    render: (r) => <span className="tabular-nums">{fmtNum(r.mean, 4)}</span>,
  },
  {
    key: "samples",
    header: "Samples",
    accessor: (r) => r.samples,
    align: "right",
    render: (r) => <span className="tabular-nums">{r.samples.toLocaleString()}</span>,
  },
  {
    key: "last_updated_at",
    header: "Last updated",
    accessor: (r) => r.last_updated_at ?? "",
    render: (r) => (
      <span className="text-xs text-muted-foreground">{fmtRelative(r.last_updated_at)}</span>
    ),
  },
];

export default function Bandit() {
  const [windowStr, setWindowStr] = useUrlState<"7" | "14" | "30">("window", "30");
  const windowDays = Number(windowStr) as WindowOption;
  const setWindow = (n: WindowOption) => setWindowStr(String(n) as "7" | "14" | "30");

  const stateQ = useQuery<BanditStateResponse>({
    queryKey: ["/api/content-platform/bandit/state"],
  });
  const learningQ = useQuery<BanditLearningResponse>({
    queryKey: ["/api/content-platform/bandit/learning-metrics"],
  });
  const regretQ = useQuery<BanditRegretResponse>({
    queryKey: [`/api/content-platform/bandit/regret?window_days=${windowDays}`],
  });

  const isLoading = stateQ.isLoading || learningQ.isLoading || regretQ.isLoading;
  const isError = stateQ.isError || learningQ.isError || regretQ.isError;
  const error = stateQ.error ?? learningQ.error ?? regretQ.error ?? null;
  const dnaConfigured =
    (stateQ.data?.dna_configured ?? true) &&
    (learningQ.data?.dna_configured ?? true) &&
    (regretQ.data?.dna_configured ?? true);

  if (isLoading && !stateQ.data && !learningQ.data && !regretQ.data) {
    return (
      <Layout
        title="Bandit Posteriors"
        subtitle="Thompson sampling state, regret, exploration ratio"
      >
        <Skeleton lines={6} />
      </Layout>
    );
  }

  if (isError) {
    return (
      <Layout
        title="Bandit Posteriors"
        subtitle="Thompson sampling state, regret, exploration ratio"
      >
        <ErrorState
          title="Failed to load bandit state"
          error={error ?? new Error("Bandit endpoints unavailable")}
          onRetry={() => {
            stateQ.refetch();
            learningQ.refetch();
            regretQ.refetch();
          }}
        />
      </Layout>
    );
  }

  if (!dnaConfigured) {
    return (
      <Layout
        title="Bandit Posteriors"
        subtitle="Thompson sampling state, regret, exploration ratio"
      >
        <EmptyState
          title="DNA service not configured"
          description={
            <>
              Set <code className="font-mono">DNA_API_BASE</code> to populate bandit posteriors.
            </>
          }
        />
      </Layout>
    );
  }

  const state = stateQ.data;
  const learning = learningQ.data;
  const regret = regretQ.data;
  const regretSeries = (regret?.points ?? []).map((p) => p.cumulative_regret);

  return (
    <Layout
      title="Bandit Posteriors"
      subtitle="Thompson sampling state, regret, exploration ratio"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Total decisions"
          value={state ? state.total_decisions.toLocaleString() : "—"}
        />
        <StatCard
          label="Exploration ratio"
          value={fmtPct(state?.exploration_ratio ?? null)}
        />
        <StatCard label="Win rate (7d)" value={fmtPct(learning?.win_rate_7d ?? null)} />
        <StatCard
          label="Convergence score"
          value={fmtNum(learning?.convergence_score ?? null, 3)}
        />
      </div>

      <section className="rounded-lg border border-card-border bg-card p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              Cumulative regret ({regret?.window_days ?? windowDays}d)
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">
              {regretSeries.length > 0
                ? fmtNum(regretSeries[regretSeries.length - 1], 3)
                : "—"}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {regretSeries.length} sample point{regretSeries.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Sparkline values={regretSeries} width={200} height={48} />
            <div className="inline-flex rounded-md border border-card-border bg-card overflow-hidden">
              {WINDOW_OPTIONS.map((opt) => (
                <button
                  key={opt}
                  onClick={() => setWindow(opt)}
                  data-testid={`window-${opt}`}
                  className={cn(
                    "px-3 py-1.5 text-sm transition-colors",
                    windowDays === opt
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground hover:bg-muted",
                  )}
                >
                  {opt}d
                </button>
              ))}
            </div>
          </div>
        </div>
        {regretSeries.length < 2 && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Not enough data points yet to render a regret trend.
          </p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {state ? `${state.arms.length} arm${state.arms.length === 1 ? "" : "s"}` : "Arms"}
          </h2>
        </div>
        <DataTable
          rows={state?.arms ?? []}
          columns={columns}
          rowKey={(r) => r.arm_id}
          defaultSort={{ key: "mean", dir: "desc" }}
          csvFilename="bandit-state"
          emptyMessage="No bandit arms recorded yet."
        />
      </section>
    </Layout>
  );
}
