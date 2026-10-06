// The audio level meter: how loud the capture is, and when a beat lands.
//
// It subscribes to the store instead of taking the value as a prop, and that
// is the whole reason it is its own component. The tab mirrors frame-rate
// slices at 2Hz so one colour bar cannot re-render its whole tree 35 times a
// second — right for a wallpaper's dominant colour, fatal for a meter whose
// entire job is temporal: a beat is a decaying envelope a few hundred
// milliseconds long, and sampling it twice a second aliases most of them away.
// This subtree is a handful of divs, so it can afford the rate the tab cannot,
// and the tab never sees the value at all.

import { useStore } from "../../store";
import { t } from "../../i18n";

export function AudioLevelMeter() {
  // Fresh object per tick from the capture engine, so this re-renders at the
  // engine's own rate — which is the point, and costs only this component.
  const audioLevel = useStore((s) => s.audioLevel);

  return (
    <div className="py-2.5">
      <div className="kicker mb-2">{t("common.audio-level")}</div>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--panel)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--motion-instant)] ease-[var(--ease-standard)]"
          style={{
            width: `${Math.round(audioLevel.volume * 100)}%`,
            // The transient is a decaying envelope, not a flag,
            // so the flash fades with the hit instead of
            // snapping off on the next frame.
            background:
              audioLevel.pulse > 0.05
                ? "rgb(var(--glow))"
                : "linear-gradient(90deg, rgb(var(--glow)), rgb(var(--glow) / 0.35))",
            boxShadow:
              audioLevel.pulse > 0.05
                ? `0 0 12px rgb(var(--glow) / ${(0.25 + audioLevel.pulse * 0.5).toFixed(2)})`
                : undefined,
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          {Math.round(audioLevel.volume * 100)}%
        </span>
        {audioLevel.pulse > 0.25 && (
          <span className="font-mono text-[10px] text-[rgb(var(--glow))]">
            {t("common.beat")}
          </span>
        )}
      </div>
      {audioLevel.deviceName && (
        <div
          className="mt-1 truncate text-[11px] text-[var(--text-dim)]"
          data-tip={audioLevel.deviceName}
        >
          {audioLevel.deviceName}
        </div>
      )}
    </div>
  );
}
