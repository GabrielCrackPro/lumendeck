
export const PERF_WINDOW = 60;

export function pushSample(
  history: readonly (number | null)[],
  value: number | null,
  limit: number = PERF_WINDOW,
): (number | null)[] {
  const next = [...history, value];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function downsample(
  values: readonly (number | null)[],
  columns: number,
): (number | null)[] {
  if (columns < 2) return [];
  if (values.length <= columns) return [...values];
  const out: (number | null)[] = [];
  for (let c = 0; c < columns; c++) {
    const from = Math.floor((c * values.length) / columns);
    const to = Math.max(from + 1, Math.floor(((c + 1) * values.length) / columns));
    let peak: number | null = null;
    for (let i = from; i < to && i < values.length; i++) {
      const v = values[i];
      if (v == null) continue;
      if (peak === null || v > peak) peak = v;
    }
    out.push(peak);
  }
  return out;
}

interface Point {
  x: number;
  y: number;
}

function reducePoints(
  values: readonly (number | null)[],
  width: number,
  height: number,
  columns: number,
): Point[][] {
  const reduced = downsample(values, columns);
  if (reduced.length === 0) return [];
  const span = reduced.length > 1 ? reduced.length - 1 : 1;
  const runs: Point[][] = [];
  let points: Point[] = [];

  reduced.forEach((v, i) => {
    if (v == null) {
      runs.push(points);
      points = [];
      return;
    }
    const clamped = Math.max(0, Math.min(100, v));
    points.push({ x: (i / span) * width, y: height - (clamped / 100) * height });
  });
  runs.push(points);
  return runs.filter((r) => r.length > 0);
}

function linePath(points: readonly Point[]): string {
  let d = `M${points[0]!.x.toFixed(2)} ${points[0]!.y.toFixed(2)}`;
  for (const p of points) d += ` L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return d;
}

function areaPath(points: readonly Point[], base: string): string {
  let d = `M${points[0]!.x.toFixed(2)} ${base}`;
  for (const p of points) d += ` L${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  const last = points[points.length - 1]!;
  return `${d} L${last.x.toFixed(2)} ${base} Z`;
}

export interface ChartGeometry {
  areas: string[];
  lines: string[];
  tail: string | null;
}

export function chartGeometry(
  values: readonly (number | null)[],
  width: number,
  height: number,
  columns: number,
): ChartGeometry {
  const base = height.toFixed(2);
  const stretches = reducePoints(values, width, height, columns);
  const areas: string[] = [];
  const lines: string[] = [];
  let tail: string | null = null;
  const landed = values[values.length - 1] != null;

  stretches.forEach((points, i) => {
    areas.push(areaPath(points, base));
    if (landed && i === stretches.length - 1 && points.length >= 2) {
      lines.push(linePath(points.slice(0, -1)));
      tail = linePath([points[points.length - 2]!, points[points.length - 1]!]);
      return;
    }
    lines.push(linePath(points));
  });

  return { areas, lines, tail };
}

export function latestValue(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}