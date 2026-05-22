import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Skeleton, EmptyState, ErrorState } from "@/components/states";
import { DollarSign, Users } from "lucide-react";

type SubscriptionsResp = {
  scriptsage_configured: boolean;
  subscriptions: {
    active_users: number;
    mrr_usd: number;
    tier_mix: { tier: string; count: number; mrr_usd: number }[];
    top_users_by_credit_burn: {
      user_id: string;
      email: string | null;
      credits_30d: number;
    }[];
  } | null;
  fetched_at: string;
};

const dash = "—";

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return dash;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return dash;
  return v.toLocaleString("en-US");
}

function truncId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}${'…'}${id.slice(-4)}`;
}

export default function SubscriptionsPage() {
  const { data, isLoading, isError, error, refetch } = useQuery<SubscriptionsResp>({
    queryKey: ["/api/content-platform/subscriptions"],
  });

  if (isLoading) {
    return (
      <Layout title="Subscriptions & Credits">
        <Skeleton lines={6} />
      </Layout>
    );
  }

  // Distinguish a real fetch failure (network/5xx) from the upstream
  // explicitly reporting that ScriptSage isn't configured. Bugbot flagged
  // that collapsing these to one empty-state hides errors.
  if (isError || !data) {
    return (
      <Layout
        title="Subscriptions & Credits"
        subtitle="ScriptSage subscription tier mix and 30-day credit burn"
      >
        <ErrorState
          title="Failed to load subscriptions"
          error={error ?? new Error("The /api/content-platform/subscriptions request failed.")}
          onRetry={() => refetch()}
        />
      </Layout>
    );
  }

  if (!data.scriptsage_configured) {
    return (
      <Layout
        title="Subscriptions & Credits"
        subtitle="ScriptSage subscription tier mix and 30-day credit burn"
      >
        <EmptyState
          title="ScriptSage not configured"
          description={
            <>
              Set <code className="font-mono">SCRIPTSAGE_API_BASE</code> to populate this section.
            </>
          }
        />
      </Layout>
    );
  }

  // Configured but upstream returned null subscriptions — surface as error,
  // not as the "not configured" empty state.
  if (!data.subscriptions) {
    return (
      <Layout
        title="Subscriptions & Credits"
        subtitle="ScriptSage subscription tier mix and 30-day credit burn"
      >
        <ErrorState
          title="Failed to load subscriptions from ScriptSage"
          error={new Error("ScriptSage is configured but returned no subscription data.")}
          onRetry={() => refetch()}
        />
      </Layout>
    );
  }

  const subs = data.subscriptions;

  return (
    <Layout
      title="Subscriptions & Credits"
      subtitle="ScriptSage subscription tier mix and 30-day credit burn"
    >
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border border-card-border bg-card p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <Users className="h-3.5 w-3.5" /> Active users
          </div>
          <div className="text-3xl font-semibold tabular-nums">
            {fmtNum(subs.active_users)}
          </div>
        </div>
        <div className="rounded-lg border border-card-border bg-card p-5">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
            <DollarSign className="h-3.5 w-3.5" /> MRR
          </div>
          <div className="text-3xl font-semibold tabular-nums">
            {fmtUsd(subs.mrr_usd)}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-card-border bg-card p-6 mb-6">
        <h2 className="text-base font-semibold mb-4">Tier mix</h2>
        {subs.tier_mix.length === 0 ? (
          <div className="text-sm text-muted-foreground">No tiers reported.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-card-border">
                  <th className="py-2 pr-4 font-medium">Tier</th>
                  <th className="py-2 pr-4 font-medium text-right">Count</th>
                  <th className="py-2 font-medium text-right">MRR</th>
                </tr>
              </thead>
              <tbody>
                {subs.tier_mix.map((t) => (
                  <tr key={t.tier} className="border-b border-card-border last:border-0">
                    <td className="py-2 pr-4 font-medium">{t.tier}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtNum(t.count)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtUsd(t.mrr_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-card-border bg-card p-6">
        <h2 className="text-base font-semibold mb-1">Top users by 30d credit burn</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Highest credit consumers over the trailing 30 days.
        </p>
        {subs.top_users_by_credit_burn.length === 0 ? (
          <div className="text-sm text-muted-foreground">No usage in the last 30 days.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground border-b border-card-border">
                  <th className="py-2 pr-4 font-medium">User ID</th>
                  <th className="py-2 pr-4 font-medium">Email</th>
                  <th className="py-2 font-medium text-right">Credits (30d)</th>
                </tr>
              </thead>
              <tbody>
                {subs.top_users_by_credit_burn.map((u) => (
                  <tr key={u.user_id} className="border-b border-card-border last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">
                      {truncId(u.user_id)}
                    </td>
                    <td className="py-2 pr-4">
                      {u.email ?? <span className="text-muted-foreground">{dash}</span>}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmtNum(u.credits_30d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Layout>
  );
}
