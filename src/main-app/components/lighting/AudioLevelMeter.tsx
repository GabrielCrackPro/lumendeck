
import { useStore } from "../../store";
import { t } from "../../i18n";

export function AudioLevelMeter() {
  const audioLevel = useStore((s) => s.audioLevel);

  return (
    <div className="py-2.5">
      <div className="kicker mb-2">{t("common.audio-level")}</div>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--panel)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-[var(--motion-instant)] ease-[var(--ease-standard)]"
          style={{
            width: `${Math.round(audioLevel.volume * 100)}%`,
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
