import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatCardDelta = { value: number; suffix?: string } | null;

function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = w / (data.length - 1);
  const points = data
    .map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="text-muted-foreground"
      data-testid="sparkline"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

function DeltaBadge({ delta, invertColors }: { delta: StatCardDelta; invertColors?: boolean }) {
  if (!delta || !Number.isFinite(delta.value)) return null;
  const { value, suffix = "" } = delta;
  const positive = value > 0;
  const negative = value < 0;
  const isGood = invertColors ? negative : positive;
  const isBad = invertColors ? positive : negative;
  const colorClass = isGood
    ? "text-emerald-600"
    : isBad
    ? "text-rose-600"
    : "text-muted-foreground";
  const arrow = positive ? "▲" : negative ? "▼" : "·";
  const sign = value > 0 ? "+" : "";
  return (
    <span
      className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", colorClass)}
      data-testid="stat-delta"
    >
      <span aria-hidden="true">{arrow}</span>
      <span>
        {sign}
        {value}
        {suffix}
      </span>
    </span>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
  delta,
  sparkline,
  invertColors,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  icon?: ReactNode;
  delta?: StatCardDelta;
  sparkline?: number[];
  invertColors?: boolean;
}) {
  const toneClass = {
    default: "border-card-border",
    good: "border-emerald-500/40",
    warn: "border-amber-500/40",
    bad: "border-rose-500/40",
  }[tone];
  const showSparkline = Array.isArray(sparkline) && sparkline.length >= 2;
  return (
    <div className={cn("rounded-lg border bg-card p-4", toneClass)}>
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <div
          className="text-2xl font-semibold tabular-nums"
          data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}
        >
          {value}
        </div>
        {delta && <DeltaBadge delta={delta} invertColors={invertColors} />}
      </div>
      {showSparkline && (
        <div className="mt-1">
          <Sparkline data={sparkline!} />
        </div>
      )}
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
