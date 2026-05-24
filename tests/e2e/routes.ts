// Single source of truth for routes the e2e suite hits. Keep in sync with
// client/src/App.tsx and client/src/components/Sidebar.tsx.
export type RouteSpec = {
  path: string;
  title: string | RegExp;
};

export const ROUTES: RouteSpec[] = [
  { path: "/", title: "Content Platform Overview" },
  { path: "/exec", title: /Executive Brief/ },
  { path: "/themes", title: /Themes/ },
  { path: "/ab-runs", title: /A\/B Experiments/ },
  { path: "/scoring", title: "IDS Scoring" },
  { path: "/bandit", title: /Bandit Posteriors/ },
  { path: "/hitl", title: /HITL Burden/ },
  { path: "/scriptsage", title: /ScriptSage Throughput/ },
  { path: "/pipeline-health", title: "Pipeline Health" },
  { path: "/veo-cost", title: /Veo Cost/ },
  { path: "/subscriptions", title: /Subscriptions/ },
  { path: "/roadmap", title: /Roadmap/ },
  { path: "/issues", title: /GitHub Issues/ },
  { path: "/explorer", title: /Self-Learning Explorer/ },
  { path: "/backlog", title: /Agent-Proposed Backlog/ },
  { path: "/run", title: "Run on Fleet" },
  { path: "/fleet", title: "Fleet Runs" },
];
