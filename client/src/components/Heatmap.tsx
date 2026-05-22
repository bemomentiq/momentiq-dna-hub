import { useMemo } from "react";

export type HeatmapCell = {
  x: string;
  y: string;
  value: number;
  label?: string;
};

type HeatmapProps = {
  cells: HeatmapCell[];
  width?: number;
  height?: number;
  colorScale?: (v: number, max: number) => string;
};

// Default scale: muted gray for 0/missing, ramps to red for max.
function defaultColorScale(v: number, max: number): string {
  if (!Number.isFinite(v) || v <= 0 || max <= 0) return "hsl(var(--muted))";
  const t = Math.min(1, v / max);
  // Lightness from 92% (very pale) down to 38% (deep red) as t grows.
  const light = 92 - 54 * t;
  return `hsl(0, 75%, ${light}%)`;
}

// Inline-SVG heatmap. Returns null when no data so callers don't need to guard.
export function Heatmap({
  cells,
  width = 600,
  height = 240,
  colorScale,
}: HeatmapProps) {
  const { xs, ys, byKey, max } = useMemo(() => {
    const xset = new Set<string>();
    const yset = new Set<string>();
    const map = new Map<string, HeatmapCell>();
    let m = 0;
    for (const c of cells) {
      xset.add(c.x);
      yset.add(c.y);
      map.set(`${c.x}::${c.y}`, c);
      if (Number.isFinite(c.value) && c.value > m) m = c.value;
    }
    return {
      xs: Array.from(xset),
      ys: Array.from(yset),
      byKey: map,
      max: m,
    };
  }, [cells]);

  if (cells.length === 0) return null;

  const labelLeft = 100;
  const labelTop = 56;
  const gridW = Math.max(width - labelLeft, 80);
  const gridH = Math.max(height - labelTop, 60);
  const cellW = gridW / Math.max(xs.length, 1);
  const cellH = gridH / Math.max(ys.length, 1);
  const scale = colorScale ?? defaultColorScale;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Heatmap"
      data-testid="heatmap"
    >
      {/* X-axis labels (rotated for readability) */}
      {xs.map((x, i) => (
        <text
          key={`xl-${x}`}
          x={labelLeft + i * cellW + cellW / 2}
          y={labelTop - 8}
          textAnchor="end"
          transform={`rotate(-35, ${labelLeft + i * cellW + cellW / 2}, ${labelTop - 8})`}
          className="fill-muted-foreground"
          fontSize="11"
        >
          {x}
        </text>
      ))}
      {/* Y-axis labels */}
      {ys.map((y, j) => (
        <text
          key={`yl-${y}`}
          x={labelLeft - 6}
          y={labelTop + j * cellH + cellH / 2 + 4}
          textAnchor="end"
          className="fill-muted-foreground"
          fontSize="11"
        >
          {y}
        </text>
      ))}
      {/* Cells */}
      {ys.map((y, j) =>
        xs.map((x, i) => {
          const cell = byKey.get(`${x}::${y}`);
          const v = cell?.value ?? 0;
          const fill = cell ? scale(v, max) : "hsl(var(--muted))";
          const label = cell?.label ?? `${x} × ${y}: ${v}`;
          return (
            <g key={`c-${x}-${y}`}>
              <rect
                x={labelLeft + i * cellW + 1}
                y={labelTop + j * cellH + 1}
                width={cellW - 2}
                height={cellH - 2}
                fill={fill}
                rx={2}
                data-testid={`heatmap-cell-${x}-${y}`}
              >
                <title>{label}</title>
              </rect>
              {cell && v > 0 && cellW > 28 && cellH > 18 && (
                <text
                  x={labelLeft + i * cellW + cellW / 2}
                  y={labelTop + j * cellH + cellH / 2 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  className="fill-foreground"
                  pointerEvents="none"
                >
                  {v}
                </text>
              )}
            </g>
          );
        }),
      )}
    </svg>
  );
}
