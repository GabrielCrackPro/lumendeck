// The geometry behind the Overview system charts.
//
// Split out because vitest runs in node with no SVG, and because the decisions
// here are the ones that can be wrong in ways nobody would notice by looking:
// a gap drawn as zero reads as a stall that never happened, and averaging a
// burst of samples erases exactly the spike the chart exists to show.
//
// Nothing here touches the DOM or reads a token -- it returns numbers and path
// strings, and the component owns the colour.

/** Samples retained for the chart: one a second, so a minute of history. */
export const PERF_WINDOW = 60;

/**
 * Append a sample, dropping the oldest past `limit`.
 *
 * Immutable rather than mutating, so React sees a new array identity per
 * sample and re-renders the path. A null sample is kept as null: it marks a
 * gap in the measurement, and dropping it would quietly close the gap and draw
 * a straight line across a period nobody measured.
 */
export function pushSample(
  history: readonly (number | null)[],
  value: number | null,
  limit: number = PERF_WINDOW,
): (number | null)[] {
  const next = [...history, value];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/**
 * Reduce the history to at most `columns` samples, keeping each column's peak.
 *
 * The peak rather than the mean, deliberately. The question the chart answers
 * is "did this machine spike", and averaging a column holding one 90% sample
 * among nine idle ones reports a busy machine as a calm one. A mean would draw
 * the opposite of the truth at exactly the moment the chart matters.
 *
 * A column with no measurement in it stays null, so a gap survives the
 * reduction instead of being filled in from a neighbouring column.
 */
export function downsample(
  values: readonly (number | null)[],
  columns: number,
): (number | null)[] {
  if (columns < 2) return [];
  if (values.length <= columns) return [...values];
  const out: (number | null)[] = [];
  for (let c = 0; c < columns; c++) {
    // Integer bucket edges across the whole history, so the last column is not
    // left holding fewer samples than the first.
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

/** One measured sample, positioned in the chart's box. */
interface Point {
  x: number;
  y: number;
}

/**
 * The measured points of each uninterrupted stretch, already positioned.
 *
 * This owns the gap rule on purpose. An earlier shape returned a flat list of
 * points with nulls dropped, which meant the path builders could not tell an
 * adjacent sample from one either side of a gap -- and would have drawn a
 * straight segment across a period with no measurement in it. Returning
 * stretches makes that unrepresentable: a gap is simply two of them.
 *
 * X comes from the position in the reduced series rather than from the index
 * within a stretch, so a run that starts late still starts at the right time on
 * the axis instead of stretching to fill the width.
 *
 * It is a function of its own because the newest point has to come off the end
 * of the last stretch. Taking that tail from a second `downsample` of a
 * shortened series would move every older sample sideways -- the x mapping
 * depends on how many points survived the reduction -- so the animated segment
 * would land on top of the line it is supposed to extend.
 */
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
    // Clamped: a reading above 100 would otherwise draw outside the box, and
    // an SVG does not clip by default.
    const clamped = Math.max(0, Math.min(100, v));
    points.push({ x: (i / span) * width, y: height - (clamped / 100) * height });
  });
  runs.push(points);
  // The old code flushed on the same condition; an empty stretch is not a run.
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

/** One series, split so its newest segment can be drawn on its own. */
export interface ChartGeometry {
  /** One per uninterrupted stretch, covering every measured point. */
  areas: string[];
  /**
   * The same stretches, with the newest segment removed from the last one so
   * the animated tail is what completes it.
   */
  lines: string[];
  /**
   * The newest segment of the newest stretch, or null when there is no segment
   * to animate yet -- a single reading, or no readings at all.
   */
  tail: string | null;
}

/**
 * The paths for a series, with the newest segment handed back separately.
 *
 * The areas deliberately keep the newest point while the line does not. If the
 * area stopped short too, the fill under the newest segment would be missing
 * for the length of the animation and the curve would appear to float; a sliver
 * of extra fill at 16% opacity is not worth that.
 *
 * Only the last stretch is split, and only when a measurement actually landed.
 * Animating every gap boundary would restart the animation somewhere other
 * than the leading edge, which is the only place a reader is looking; and a
 * trailing gap means the newest sample measured nothing, so there is nothing
 * new to reveal and the run before it is left whole.
 */
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

/** The most recent measured value, or null when the tail is a gap. */
export function latestValue(values: readonly (number | null)[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v != null) return v;
  }
  return null;
}