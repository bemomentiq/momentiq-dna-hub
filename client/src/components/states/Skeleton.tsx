import { cn } from "@/lib/utils";

type Props = {
  lines?: number;
  className?: string;
};

export function Skeleton({ lines = 3, className }: Props) {
  return (
    <div className={cn("space-y-2", className)} data-testid="skeleton">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded bg-muted/60 animate-pulse"
          style={{ width: `${80 + ((i * 13) % 20)}%` }}
        />
      ))}
    </div>
  );
}
