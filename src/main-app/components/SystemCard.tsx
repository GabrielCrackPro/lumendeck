
import { useEffect, useState } from "react";
import { api } from "../ipc";
import { Card } from "./ui";
import { IconSliders } from "./icons";
import { t } from "../i18n";
import { chartGeometry, latestValue, pushSample, PERF_WINDOW } from "./perfChart";
import { perfReadout } from "./perfReadout";
import type { PerfSnapshot } from "@shared/types";

const VB_W = 100;
const VB_H = 34;

const POLL_MS = 1000;

const LINE_STROKE = {
  fill: "none",
  stroke: "rgb(var(--glow))",
  strokeWidth: 1.5,
  strokeLinejoin: "round",
  strokeLinecap: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

interface History {
  cpu: (number | null)[];
  mem: (number | null)[];
  snap: PerfSnapshot | null;
  seq: number;
}

function memPercent(snap: PerfSnapshot): number | null {
  const { memUsedBytes: used, memTotalBytes: total } = snap;
  if (used == null || total == null || total <= 0) return null;
  return (used / total) * 100;
}

function Chart({
  label,
  series,
  seq,
  children,
  warn,
}: {
  label: string;
  series: (number | null)[];
  seq: number;
  children: React.ReactNode;
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
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="mt-1.5 h-12 w-full"
        role="img"
        aria-label={label}
      >
        {

 }
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
        {

 }
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
      {

 }
      <p className="mt-3.5 text-[11px] leading-relaxed text-[var(--text-faint)]">
        {t("common.spikes-here-usually-mean-the-wallpaper-or-the-lighting")}
      </p>
    </Card>
  );
}