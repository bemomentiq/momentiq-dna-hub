import { RefreshCw } from "lucide-react";
import { useIsFetching } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";

export function RefreshAll() {
  const fetching = useIsFetching();
  const isBusy = fetching > 0;

  const onClick = () => {
    queryClient.invalidateQueries();
    // Fire-and-forget: clear server-side cache too.
    void fetch("/api/content-platform/cache/bust", { method: "POST" }).catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isBusy}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Refresh all data"
      data-testid="button-refresh-all"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">Refresh</span>
    </button>
  );
}
