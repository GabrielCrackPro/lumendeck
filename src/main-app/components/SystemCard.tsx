// The System card: what the machine is doing while LumenDeck runs.
//
// The header strip prints the dashboard's own frame rate, and that number is
// only interpretable next to a question it cannot answer alone -- is 58fps a
// problem, or is the machine simply busy? This card is the answer, and it is
// a chart rather than two numbers because the shape is the point: a machine
// that idles at 60% and spikes to 100% has the same average as one that sits
// at 80% flat, and only one of those is a problem worth acting on.
//
// Polling lives here rather than in the tab so the Overview does not own it,
// and so unmounting the card stops the timer with it.

import { useEffect, useState } from "react";
import { api } from "../ipc";
import { Card } from "./ui";
import { IconSliders } from "./icons";
import { t } from "../i18n";
import { chartGeometry, latestValue, pushSample, PERF_WINDOW } from "./perfChart";
import { perfReadout } from "./perfReadout";
import type { PerfSnapshot } from "@shared/types";

/**
 * Chart geometry, in viewBox units rather than pixels.
 *
 * The SVG carries `preserveAspectRatio="none"` and scales to whatever width
 * the card gives it, so the paths are computed once against a fixed box and
 * never recomputed on resize. The stroke carries `non-scaling-stroke` so the
 * horizontal stretch does not also fatten the line -- without it a wide card
 * draws a visibly thicker line than a narrow one.
 */
const VB_W = 100;
const VB_H = 34;

/** Poll interval; matches the backend sampler's own rate. */
const POLL_MS = 1000;

/**
 * The stroke the line and its animated tail share.
 *
 * One object so the tail cannot drift from the settled line it extends -- a
 * different width or cap on the newest segment is the kind of difference
 * nobody would report but everybody would see.
 */
const LINE_STROKE = {
  fill: "none",
  stroke: "rgb(var(--glow))",
  strokeWidth: 1.5,
  strokeLinejoin: "round",
  strokeLinecap: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

/** What one poll produced: the two series, and the newest snapshot. */
interface History {
  cpu: (number | null)[];
  mem: (number | null)[];
  snap: PerfSnapshot | null;
  /**
   * Successful polls so far.
   *
   * Carried rather than derived from the series lengths, which both stop
   * changing once the window is full. It exists only to key the animation, and
   * it counts polls rather than samples so a failed read -- which pushes
   * nothing -- does not restart a curve that did not change.
   */
  seq: number;
}

/**
 * Memory as a percentage, or null when it cannot be computed.
 *
 * The chart wants a percentage like every other series, and a machine
 * reporting zero installed memory would divide by zero -- so this returns
 * null and the chart draws a gap rather than an infinity.
 */
function memPercent(snap: PerfSnapshot): number | null {
  const { memUsedBytes: used, memTotalBytes: total } = snap;
  if (used == null || total == null || total <= 0) return null;
  return (used / total) * 100;
}

/**
 * One chart: a label, its current reading, and the area/line beneath.
 *
 * `children` is the value readout so the caller owns the wording and the
 * warning state; this owns only the drawing.
 */
function Chart({
  label,
  series,
  seq,
  children,
  warn,
}: {
  label: string;
  series: (number | null)[];
  /**
   * How many readings have landed, used only as a key.
   *
   * The series stops growing once it is full, so keying on its length would
   * stop the animation after the first minute. Counting the polls is what makes
   * the newest segment replay on every reading instead of only the first time
   * it is mounted.
   */
  seq: number;
  /** The right-hand readout: a formatted value, or whatever marks a problem. */
  children: React.ReactNode;
  /** Draws the reading in the caution colour. */
  warn?: boolean;
}) {
  const { areas, lines, tail } = chartGeometry(series, VB_W, VB_H, PERF_WINDOW);
  const hasData = lines.length > 0;
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="kicker text-[var(--text-faint)]">{label}</span>
        <span
          className={`font-mono text-[11px] tabular-nums ${
            warn ? "text-amber-400" : "text-[var(--text-dim)]"
          }`}
        >
          {children}
        </span>
      </div>
      <svg
        // `none` plus a fixed viewBox: the geometry is computed once and
        // stretched to the card, so a resize does not mean recomputing paths.
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="mt-1.5 h-12 w-full"
        role="img"
        aria-label={label}
      >
        {/* The 50% guide. Without a reference the curve has no scale, and a
            hump that reaches halfway looks identical to one that reaches 90%
            when nothing else on the card says which it is. */}
        <line
          x1={0}
          x2={VB_W}
          y1={VB_H / 2}
          y2={VB_H / 2}
          stroke="var(--line)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={0}
          x2={VB_W}
          y1={VB_H}
          y2={VB_H}
          stroke="var(--line-strong)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {areas.map((d, i) => (
          <path key={`area${i}`} d={d} fill="rgb(var(--glow) / 0.16)" />
        ))}
        {lines.map((d, i) => (
          <path key={`line${i}`} d={d} {...LINE_STROKE} />
        ))}
        {/* The newest segment, arriving. Drawn last so it sits over the settled
            line's end rather than under it, and keyed per reading so each one
            animates instead of the first animation being left on screen. */}
        {tail && <path key={`tail${seq}`} className="chart-tail" d={tail} {...LINE_STROKE} />}
      </svg>
      {!hasData && (
        <p className="mt-1 font-mono text-[10px] text-[var(--text-faint)]">
          {t("common.chart-waiting-for-a-reading")}
        </p>
      )}
    </div>
  );
}

export default function SystemCard() {
  const [history, setHistory] = useState<History>({
    cpu: [],
    mem: [],
    snap: null,
    seq: 0,
  });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (disposed) return;
      try {
        const snap = await api.perfSnapshot();
        if (!disposed) {
          setHistory((h) => ({
            cpu: pushSample(h.cpu, snap.cpuPercent),
            mem: pushSample(h.mem, memPercent(snap)),
            snap,
            seq: h.seq + 1,
          }));
        }
      } catch {
        // A failed read pushes nothing, so the chart grows a gap for that
        // second rather than inventing a value. Clearing the series instead
        // would make one IPC hiccup erase a minute of history.
      }
      if (!disposed) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    const onVisibility = () => {
      if (timer != null) {
        clearTimeout(timer);
        timer = undefined;
      }
      // Resume re-reads immediately, so the chart never resumes showing a
      // reading from before the card was hidden.
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const snap = history.snap;
  // The readouts and the stale threshold come from `perfReadout`, which owns
  // them. This card does not keep its own copy of the age rule: two thresholds
  // that agree today are two thresholds that will not after one of them is
  // edited.
  const readout = perfReadout(snap);
  const memPct = latestValue(history.mem);

  return (
    <Card
      title={t("common.system")}
      icon={<IconSliders />}
      right={
        readout.stale ? (
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-amber-300/90">
            {t("common.reading-is-stale-the-sampler-stopped")}
          </span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <Chart label={t("common.cpu")} series={history.cpu} seq={history.seq}>
          {readout.cpu ?? "--"}
        </Chart>
        <Chart
          label={t("common.memory")}
          series={history.mem}
          seq={history.seq}
          warn={readout.pressure === "tight"}
        >
          {readout.memory ?? "--"}
          {readout.pressure === "tight" && memPct != null && (
            <span className="ml-1.5 text-amber-400">
              {t("common.{n}-percent", { n: Math.round(memPct) })}
            </span>
          )}
        </Chart>
      </div>
      {/* What the two curves are for, in one line. The card answers "is the
          machine busy", which is only a useful answer if the reader knows what
          to do with it -- and the common cause is LumenDeck itself. */}
      <p className="mt-3.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
        {t("common.spikes-here-usually-mean-the-wallpaper-or-the-lighting")}
      </p>
    </Card>
  );
}