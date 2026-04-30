import { ReactNode, useState } from "react";
import { Sidebar } from "./Sidebar";
import { Menu } from "lucide-react";

export function Layout({ children, title, subtitle, actions }: { children: ReactNode; title: string; subtitle?: string; actions?: ReactNode }) {
  // Mobile drawer state — Sidebar reads this to slide in/out below the lg breakpoint.
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="flex min-h-screen bg-background text-foreground">
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
                {subtitle && <p className="text-xs sm:text-sm text-muted-foreground mt-1 line-clamp-2">{subtitle}</p>}
              </div>
            </div>
            {actions && <div className="shrink-0 hidden sm:block">{actions}</div>}
          </div>
          {/* On very narrow screens, drop the actions onto a second row so the title doesn't get squeezed. */}
          {actions && (
            <div className="sm:hidden border-t border-border/50 px-4 py-2 flex items-center gap-2 overflow-x-auto">
              {actions}
            </div>
          )}
        </header>
        <div className="px-4 sm:px-6 lg:px-8 py-4 lg:py-6">{children}</div>
      </main>
    </div>
  );
}
