import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ExternalLink, AlertTriangle, Milestone as MilestoneIcon } from "lucide-react";

type Milestone = {
  repo: string;
  number: number;
  title: string;
  description: string | null;
  state: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
  html_url: string;
};

type EpicIssue = {
  repo: string;
  number: number;
  title: string;
  state: string;
  html_url: string;
  labels: string[];
  updated_at: string;
};

type EpicGroup = {
  label: string;
  title: string;
  description: string;
  open: number;
  closed: number;
  total: number;
  issues: EpicIssue[];
  html_url: string;
};

type RoadmapResp = {
  milestones: Milestone[];
  epics: EpicGroup[];
  repos: string[];
  errors: string[];
  fetched_at: string;
};

function pct(closed: number, total: number) {
  return total === 0 ? 0 : Math.round((closed / total) * 100);
}

function shortRepo(repo: string) {
  return repo.replace(/^bemomentiq\//, "");
}

export default function Roadmap() {
  const { data, isLoading, error } = useQuery<RoadmapResp>({
    queryKey: ["/api/content-platform/roadmap"],
  });

  const tokenMissing =
    (error as any)?.message?.includes("400") ||
    (error as any)?.message?.toLowerCase?.().includes("github token");

  const milestones = data?.milestones ?? [];
  const epics = data?.epics ?? [];

  const totalOpen = milestones.reduce((s, m) => s + m.open_issues, 0);
  const totalClosed = milestones.reduce((s, m) => s + m.closed_issues, 0);
  const totalAll = totalOpen + totalClosed;

  return (
    <Layout
      title="Live Roadmap"
      subtitle={`GitHub milestones + epics across ${data?.repos.length ?? 4} content repos · ${totalClosed}/${totalAll} issues closed`}
    >
      {tokenMissing && (
        <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
          <CardContent className="pt-6 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm">
              <div className="font-medium">GitHub token not configured</div>
              <div className="text-muted-foreground mt-1">
                Set <code className="text-xs">github_token</code> in cron config (or
                <code className="text-xs ml-1">GITHUB_TOKEN</code> env var) to enable live milestone data.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="text-sm text-muted-foreground">Loading milestones…</div>
      )}

      {data && (
        <>
          <div className="grid lg:grid-cols-3 gap-3 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="uppercase text-xs tracking-wide">Overall Progress</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{pct(totalClosed, totalAll)}%</div>
                <Progress value={pct(totalClosed, totalAll)} className="h-1.5 mt-2" />
                <div className="text-xs text-muted-foreground mt-1.5">{totalClosed} closed · {totalOpen} open</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="uppercase text-xs tracking-wide">Active Milestones</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{milestones.filter((m) => m.state === "open").length}</div>
                <div className="text-xs text-muted-foreground mt-1.5">{milestones.length} total across repos</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="uppercase text-xs tracking-wide">Epics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold tabular-nums">{epics.length}</div>
                <div className="text-xs text-muted-foreground mt-1.5">Grouped by <code className="text-[10px]">epic:*</code> labels</div>
              </CardContent>
            </Card>
          </div>

          {epics.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">Epics</h2>
              <div className="grid gap-4">
                {epics.map((epic) => {
                  const epicPct = pct(epic.closed, epic.total);
                  return (
                    <Card key={epic.label}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <CardTitle className="text-base flex items-center gap-2">
                              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                                {epic.label}
                              </span>
                              <span>{epic.title}</span>
                            </CardTitle>
                            {epic.description && (
                              <CardDescription className="mt-1">{epic.description}</CardDescription>
                            )}
                          </div>
                          <a
                            href={epic.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                          >
                            GitHub <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground tabular-nums">
                            {epic.closed} closed / {epic.total} total
                          </span>
                          <span className="tabular-nums font-medium">{epicPct}%</span>
                        </div>
                        <Progress value={epicPct} className="h-1.5" />
                        {epic.issues.length > 0 && (
                          <ul className="mt-4 space-y-1.5">
                            {epic.issues.slice(0, 6).map((iss) => (
                              <li key={`${iss.repo}#${iss.number}`} className="text-sm flex items-baseline gap-2">
                                <span
                                  className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${
                                    iss.state === "closed" ? "bg-emerald-500" : "bg-amber-500"
                                  }`}
                                />
                                <a
                                  href={iss.html_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:underline truncate"
                                >
                                  {iss.title}
                                </a>
                                <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                                  {shortRepo(iss.repo)}#{iss.number}
                                </span>
                              </li>
                            ))}
                            {epic.issues.length > 6 && (
                              <li className="text-xs text-muted-foreground">
                                + {epic.issues.length - 6} more
                              </li>
                            )}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-lg font-semibold mb-3">Milestones</h2>
            {milestones.length === 0 ? (
              <Card>
                <CardContent className="pt-6 text-sm text-muted-foreground">
                  No milestones found across the content repos.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {milestones.map((m) => {
                  const total = m.open_issues + m.closed_issues;
                  const mPct = pct(m.closed_issues, total);
                  return (
                    <Card key={`${m.repo}#${m.number}`}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <CardTitle className="text-base flex items-center gap-2">
                              <MilestoneIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="truncate">{m.title}</span>
                              {m.state === "closed" && (
                                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
                                  closed
                                </span>
                              )}
                            </CardTitle>
                            <div className="text-xs text-muted-foreground mt-1 font-mono">
                              {shortRepo(m.repo)}
                              {m.due_on && ` · due ${new Date(m.due_on).toLocaleDateString()}`}
                            </div>
                            {m.description && (
                              <CardDescription className="mt-2">{m.description}</CardDescription>
                            )}
                          </div>
                          <a
                            href={m.html_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 shrink-0"
                          >
                            GitHub <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground tabular-nums">
                            {m.closed_issues} closed · {m.open_issues} open
                          </span>
                          <span className="tabular-nums font-medium">{mPct}%</span>
                        </div>
                        <Progress value={mPct} className="h-1.5" />
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

          {data.errors.length > 0 && (
            <div className="mt-6 text-xs text-muted-foreground">
              <span className="font-medium">Partial errors:</span> {data.errors.join("; ")}
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
