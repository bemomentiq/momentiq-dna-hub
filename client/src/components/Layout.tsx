import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Menu } from "lucide-react";
import { LastUpdated } from "./LastUpdated";
import { RefreshAll } from "./RefreshAll";
import { PollingControl } from "./PollingControl";
import { CommandPalette } from "./CommandPalette";

export function Layout({
  children,
  title,
  subtitle,
  actions,
  breadcrumbs,
}: {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumbs?: ReactNode;
}) {
  // Mobile drawer state — Sidebar reads this to slide in/out below the lg breakpoint.
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <CommandPalette />
      <Sidebar mobileOpen={navOpen} onClose={() => setNavOpen(false)} />
      <main className="flex-1 min-w-0">
        <header className="border-b border-border bg-card/30 backdrop-blur sticky top-0 z-20">
          <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-5 flex items-start justify-between gap-3 sm:gap-6">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              {/* Mobile hamburger — hidden on lg+ where the sidebar is permanent */}
              <button
                onClick={() => setNavOpen(true)}
                className="lg:hidden mt-0.5 p-1.5 -ml-1 rounded-md hover:bg-accent text-foreground shrink-0"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <h1 className="text-lg sm:text-xl font-semibold tracking-tight truncate" data-testid="text-page-title">{title}</h1>
                {breadcrumbs && <div className="mt-1 text-xs text-muted-foreground" data-testid="layout-breadcrumbs">{breadcrumbs}</div>}
                {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">{subtitle}</p>}
              </div>
            </div>
            <div className="shrink-0 hidden sm:flex items-center gap-2">
              <LastUpdated />
              <PollingControl />
              <RefreshAll />
              {actions}
            </div>
          </div>
          {/* On very narrow screens, drop the actions onto a second row so the title doesn't get squeezed. */}
          <div className="sm:hidden border-t border-border/50 px-4 py-2 flex items-center gap-2 overflow-x-auto">
            <LastUpdated />
            <PollingControl />
            <RefreshAll />
            {actions}
          </div>
        </header>
        <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6">{children}</div>
      </main>
    </div>
  );
}
