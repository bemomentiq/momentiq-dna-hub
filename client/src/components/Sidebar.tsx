import { Link, useLocation } from "wouter";
import { LayoutDashboard, Grid3x3, Map, Database, GitPullRequest, Activity, DollarSign, Workflow, ClipboardCheck, Hourglass, Brain, Rocket, Send, Cpu, X, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/exec", label: "Executive Brief", icon: ClipboardCheck },
  { href: "/autonomy", label: "Autonomy", icon: Gauge },
  { href: "/explorer", label: "Explorer", icon: Brain, group: "agent" },
  { href: "/backlog", label: "Agent Backlog", icon: Rocket, group: "agent" },
  { href: "/run", label: "Run on Fleet", icon: Send, group: "agent" },
  { href: "/fleet", label: "Fleet Runs", icon: Cpu, group: "agent" },
  { href: "/actions", label: "All Actions", icon: Grid3x3 },
  { href: "/roadmap", label: "Roadmap", icon: Map },
  { href: "/training", label: "Training Data", icon: Database },
  { href: "/pipeline", label: "Data Pipeline", icon: Workflow },
  { href: "/evals", label: "Evals", icon: Activity },
  { href: "/hitl", label: "HITL Burden", icon: Hourglass },
  { href: "/money-path", label: "Money Path", icon: DollarSign },
  { href: "/issues", label: "GitHub Issues", icon: GitPullRequest },
];

// Sidebar renders as a permanent rail on lg+ and as a slide-in drawer on smaller
// screens. The parent Layout owns the open/close state so the header hamburger
// can drive it without prop-drilling through every page.
export function Sidebar({ mobileOpen = false, onClose }: { mobileOpen?: boolean; onClose?: () => void }) {
  const [loc] = useLocation();
  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-background/70 backdrop-blur-sm z-30"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "w-60 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col",
          // Permanent rail on lg+
          "lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          // Drawer on <lg
          "fixed inset-y-0 left-0 h-screen z-40 transition-transform duration-200 ease-out",
          mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="px-5 py-5 border-b border-sidebar-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-label="Autonomy Hub logo">
              <rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
              <rect x="13" y="3" width="8" height="8" rx="1.5" fill="hsl(var(--primary))" />
              <rect x="3" y="13" width="8" height="8" rx="1.5" fill="hsl(var(--primary))" />
              <rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <div>
              <div className="font-semibold text-sm leading-tight">Autonomy Hub</div>
              <div className="text-[11px] text-muted-foreground">SID 40-action tracker</div>
            </div>
          </div>
          {/* Mobile-only close button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-md hover:bg-sidebar-accent text-muted-foreground"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {items.map((it) => {
            // Exact-match the home route; for everything else, prefix-match so child routes
            // (e.g. /actions/:name) keep the parent active.
            const active = loc === it.href || (it.href !== "/" && loc.startsWith(it.href + "/")) || loc === it.href;
            const Icon = it.icon;
            return (
              <Link
                key={it.href}
                href={it.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent"
                )}
                data-testid={`nav-${it.label.toLowerCase().replace(/\s/g, "-")}`}
              >
                <Icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-4 py-3 border-t border-sidebar-border text-[11px] text-muted-foreground">
          <div>Snapshot: 2026-04-29</div>
          <div className="mt-1">SID main · R195</div>
        </div>
      </aside>
    </>
  );
}
