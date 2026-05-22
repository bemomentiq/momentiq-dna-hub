import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { queryClient } from "@/lib/queryClient";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

// Mirrors the sidebar `items` array — when sidebar gains a route, add it here too.
// Pipeline Health lives between ScriptSage and Veo Cost; matches PR #53.
const PAGES: { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/exec", label: "Executive Brief" },
  { href: "/themes", label: "Themes" },
  { href: "/ab-runs", label: "A/B Runs" },
  { href: "/scoring", label: "IDS Scoring" },
  { href: "/bandit", label: "Bandit" },
  { href: "/scriptsage", label: "ScriptSage" },
  { href: "/pipeline-health", label: "Pipeline Health" },
  { href: "/veo-cost", label: "Veo Cost & ROI" },
  { href: "/subscriptions", label: "Subscriptions" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/issues", label: "GitHub Issues" },
  { href: "/autonomy", label: "Autonomy" },
  { href: "/explorer", label: "Explorer" },
  { href: "/backlog", label: "Agent Backlog" },
  { href: "/run", label: "Run on Fleet" },
  { href: "/fleet", label: "Fleet Runs" },
];

const POLLING_STORAGE_KEY = "dnaHubPollingPaused";

function setPolling(paused: boolean) {
  const opts = queryClient.getDefaultOptions();
  if (!opts.queries) opts.queries = {};
  if (paused) {
    opts.queries.refetchOnWindowFocus = false;
    opts.queries.refetchOnReconnect = false;
    opts.queries.refetchInterval = false;
    queryClient.invalidateQueries({ refetchType: "none" });
  } else {
    opts.queries.refetchOnWindowFocus = true;
    opts.queries.refetchOnReconnect = true;
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(POLLING_STORAGE_KEY, paused ? "1" : "0");
  }
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();

  // Bind Cmd+K / Ctrl+K globally.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries();
    void fetch("/api/content-platform/cache/bust", { method: "POST" }).catch(() => {});
    setOpen(false);
  }, []);

  const pause = useCallback(() => {
    setPolling(true);
    setOpen(false);
  }, []);

  const resume = useCallback(() => {
    setPolling(false);
    setOpen(false);
  }, []);

  const clearServerCache = useCallback(() => {
    void fetch("/api/content-platform/cache/bust", { method: "POST" }).catch(() => {});
    setOpen(false);
  }, []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages and actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem
              key={p.href}
              value={`page ${p.label} ${p.href}`}
              onSelect={() => go(p.href)}
              data-testid={`cmdk-page-${p.href}`}
            >
              {p.label}
              <CommandShortcut>{p.href}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem value="refresh all data" onSelect={refreshAll} data-testid="cmdk-action-refresh">
            Refresh all data
          </CommandItem>
          <CommandItem value="pause polling" onSelect={pause} data-testid="cmdk-action-pause">
            Pause polling
          </CommandItem>
          <CommandItem value="resume polling" onSelect={resume} data-testid="cmdk-action-resume">
            Resume polling
          </CommandItem>
          <CommandItem
            value="clear server cache"
            onSelect={clearServerCache}
            data-testid="cmdk-action-clear-cache"
          >
            Clear server cache
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
