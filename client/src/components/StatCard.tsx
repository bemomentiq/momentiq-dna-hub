import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: ReactNode;
}) {
  const toneClass = {
    default: "border-card-border",
    good: "border-emerald-500/40",
    warn: "border-amber-500/40",
    bad: "border-rose-500/40",
  }[tone];
  return (
    <div className={cn("rounded-lg border bg-card p-4", toneClass)}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function ProgressBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "good" | "warn" | "bad" }) {
  const v = Math.max(0, Math.min(100, value));
  const fill = {
    primary: "bg-primary",
    good: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500",
  }[tone];
  return (
    <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className={cn("h-full transition-all", fill)} style={{ width: `${v}%` }} />
    </div>
  );
}
