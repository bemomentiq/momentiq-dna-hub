// Tiny inline SVG sparkline with no deps. Auto-scales to the min/max of the
// input values and renders a single <polyline>. Returns null for <2 points so
// callers can drop it in next to a stat without conditional wrappers.

type Props = {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
};

export function Sparkline({ values, width = 80, height = 24, stroke }: Props) {
  if (!values || values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      data-testid="sparkline"
      aria-hidden="true"
      style={stroke ? { color: stroke } : undefined}
    >
      <polyline
        fill="none"
        stroke={stroke ?? "currentColor"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}
