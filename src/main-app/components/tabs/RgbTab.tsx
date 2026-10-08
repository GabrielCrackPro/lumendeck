import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Toggle, Slider, Btn, Chip, ColorInput, EmptyState, Section, Segmented, Select, InfoNote, IconBox } from "../ui";
import { DeviceRow } from "../DeviceRow";
import { LiveStage } from "../lighting/LiveStage";
import { AudioLevelMeter } from "../lighting/AudioLevelMeter";
import { ModePicker } from "../lighting/ModePicker";
import { IconBulb, IconRefresh, IconZap } from "../icons";
import { RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import type { RgbMode } from "@shared/types";
import { ledCounts } from "../deviceList";
import { previewLiveColor } from "../deviceLights";
import { usePending } from "../../pending";
import { t } from "../../i18n";

type StoreState = ReturnType<typeof useStore.getState>;

const selectDeviceColors = (s: StoreState) => s.deviceColors;

function useThrottledStoreSlice<T>(select: (s: StoreState) => T, ms = 500): T {
  const [value, setValue] = useState(() => select(useStore.getState()));
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let changed = false;
    const un = useStore.subscribe((s, prev) => {
      if (select(s) !== select(prev)) changed = true;
      if (timer == null) {
        timer = setInterval(() => {
          if (!changed) return;
          changed = false;
          setValue(select(useStore.getState()));
        }, ms);
      }
    });
    return () => {
      un();
      if (timer) clearInterval(timer);
    };
  }, [select, ms]);
  return value;
}

const IDLE_TIMEOUT_OPTIONS = [
  { id: "30", label: "30 s" },
  { id: "60", label: "1 min" },
  { id: "120", label: "2 min" },
  { id: "300", label: "5 min" },
  { id: "600", label: "10 min" },
  { id: "900", label: "15 min" },
  { id: "1800", label: "30 min" },
  { id: "3600", label: "1 h" },
];

const IDLE_CHECK_OPTIONS = [
  { id: "1", label: "1 s" },
  { id: "2", label: "2 s" },
  { id: "5", label: "5 s" },
  { id: "10", label: "10 s" },
  { id: "30", label: "30 s" },
  { id: "60", label: "60 s" },
];

const WRITE_INTERVAL_OPTIONS = [
  { id: "30", label: "30 ms" },
  { id: "60", label: "60 ms" },
  { id: "120", label: "120 ms" },
  { id: "250", label: "250 ms" },
  { id: "500", label: "500 ms" },
  { id: "1000", label: "1000 ms" },
];

function presetOptions(
  presets: { id: string; label: string }[],
  current: string,
  format: (v: number) => string,
): { id: string; label: string }[] {
  if (!current || presets.some((p) => p.id === current)) return presets;
  return [...presets, { id: current, label: format(Number(current)) }];
}

function formatIdle(v: number): string {
  if (v < 60) return `${v} s`;
  const m = Math.floor(v / 60);
  const s = v % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

export default function RgbTab() {
  const { cfg, rgb, save } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      save: s.save,
    })),
  );
  const { pending: retryPending, run: runRetry } = usePending();
  const deviceColors = useThrottledStoreSlice(selectDeviceColors);
  if (!cfg) return null;
  const rgbCfg = cfg.rgb;
  const isAnimated = (ANIMATION_MODES as ReadonlySet<RgbMode>).has(rgbCfg.mode);

  const counts = ledCounts(rgb.devices, rgbCfg.excludedDevices);
  const ledTotal = counts.total;
  const activeLeds = counts.active;
  const mutedCount = counts.muted;
  const activeMode = RGB_MODES.find((m) => m.id === rgbCfg.mode);
  const liveWallpaperColor = previewLiveColor(deviceColors, rgb.devices, rgbCfg.excludedDevices);

  return (
    <div className="@container stagger space-y-4 sm:space-y-5">

      <LiveStage
        enabled={rgbCfg.enabled}
        connected={rgb.connected}
        accentLive={cfg.general.accentLive ?? false}
        mode={rgbCfg.mode}
        modeGroupTitle={t(
          activeMode?.group === "animation"
            ? "lighting.animated-mode"
            : "lighting.reactive-mode",
        )}
        modeLabel={activeMode ? t(activeMode.label) : rgbCfg.mode}
        devices={rgb.devices}
        deviceNames={rgbCfg.deviceNames}
        totalLeds={ledTotal}
        activeLeds={activeLeds}
        brightnessPct={Math.round(rgbCfg.mixer.brightness * 100)}
        speedLabel={`${rgbCfg.animationSpeed.toFixed(1)}×`}
        isAnimated={isAnimated}
        smoothingPct={Math.round(rgbCfg.mixer.smoothing * 100)}
        accentDevice={rgbCfg.accentDevice}
        onAccentDevice={(v) =>
          save((c) => {
            c.rgb.accentDevice = v;
          })
        }
        onToggleEnabled={(v) => save((c) => (c.rgb.enabled = v))}
        onToggleAccentLive={(v) => save((c) => (c.general.accentLive = v))}
      />


      <div className="grid items-start gap-4 @[50rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @[64rem]:gap-5">
        <div className="space-y-5">
          <Card
            anchor="devices"
            title={t("common.devices")}
            right={
              rgb.connected ? (
                <span className="hint">
                  {t("common.{n}-devices-{active}-of-{total}-leds", {
                    n: rgb.devices.length,
                    active: activeLeds.toLocaleString(),
                    total: ledTotal.toLocaleString(),
                  })}
                </span>
              ) : undefined
            }
          >

            {rgb.connected && rgb.devices.length === 0 && (
              <EmptyState
                icon={<IconBulb className="h-6 w-6" />}
                title={t("common.connected-but-no-devices-reported-yet")}
              />
            )}
            {rgb.connected && rgb.devices.length > 0 && (
              <ul className="space-y-2">
                {rgb.devices.map((d) => {
                  const muted = rgbCfg.excludedDevices.includes(d.id);
                  return (
                    <DeviceRow
                      key={d.id}
                      device={d}
                      muted={muted}
                      onToggleMute={() =>
                        save((c) => {
                          const set = new Set(c.rgb.excludedDevices);
                          if (set.has(d.id)) set.delete(d.id);
                          else set.add(d.id);
                          c.rgb.excludedDevices = [...set];
                        })
                      }
                      deviceNames={rgbCfg.deviceNames}
                      onRename={(name) =>
                        save((c) => {
                          const names = { ...c.rgb.deviceNames };
                          if (name) names[String(d.id)] = name;
                          else delete names[String(d.id)];
                          c.rgb.deviceNames = names;
                        })
                      }
                    />
                  );
                })}
              </ul>
            )}
            {!rgb.connected && (
              <div className="space-y-3.5 text-sm text-[var(--text-dim)]">
                <div className="flex items-start gap-3 panel-inset p-3.5">
                  <span className="mt-0.5">
                    <IconBox variant="amber">
                      <IconZap />
                    </IconBox>
                  </span>
                  <div className="min-w-0">
                    <p className="leading-relaxed">
                      {t("common.start")}{" "}
                      <b className="font-semibold text-[var(--text)]">
                        {t("common.openrgb")}
                      </b>{" "}
                      {t("common.with-the-sdk-server-enabled-settings-server-star")}
                    </p>
                    {rgb.lastError && (
                      <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-[var(--text-faint)]">
                        {rgb.lastError}
                      </p>
                    )}
                  </div>
                </div>
                <Btn
                  variant="primary"
                  pending={retryPending.has("retry")}
                  onClick={() => runRetry("retry", () => useStore.getState().load())}
                >

                  {!retryPending.has("retry") && (
                    <IconRefresh className="h-4 w-4" />
                  )}
                  {t("common.retry")}
                </Btn>
              </div>
            )}

            {rgb.connected && mutedCount > 0 && (
              <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.{n}-devices-are-muted-muted-hardware-keeps-its-l", { n: mutedCount })}
              </p>
            )}
          </Card>


          <Card anchor="automation" title={t("common.automation")}>
            <Toggle
              label={t("common.turn-off-lights-when-idle")}
              description={t("common.automatically-turn-off-rgb-after-a-period-of-no")}
              checked={rgbCfg.idleTimeoutSec > 0}
              onChange={(v) =>
                save((c) => {
                  c.rgb.idleTimeoutSec = v ? 300 : 0;
                  if (!c.rgb.idleCheckIntervalSec || c.rgb.idleCheckIntervalSec < 1) {
                    c.rgb.idleCheckIntervalSec = 10;
                  }
                })
              }
            />
            {rgbCfg.idleTimeoutSec > 0 && (
              <>
                <Select
                  label={t("common.idle-timeout")}
                  value={String(rgbCfg.idleTimeoutSec)}
                  options={presetOptions(
                    IDLE_TIMEOUT_OPTIONS,
                    String(rgbCfg.idleTimeoutSec),
                    formatIdle,
                  )}
                  onChange={(v) => save((c) => (c.rgb.idleTimeoutSec = Number(v)))}
                />
                <Select
                  label={t("common.check-interval")}
                  value={String(rgbCfg.idleCheckIntervalSec)}
                  options={presetOptions(
                    IDLE_CHECK_OPTIONS,
                    String(rgbCfg.idleCheckIntervalSec),
                    (v) => `${v} s`,
                  )}
                  onChange={(v) => save((c) => (c.rgb.idleCheckIntervalSec = Number(v)))}
                />
              </>
            )}

            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <Toggle
                label={t("common.night-dimming")}
                description={t("common.cap-led-brightness-during-a-nightly-window")}
                checked={!!rgbCfg.nightStart && !!rgbCfg.nightEnd}
                onChange={(v) =>
                  save((c) => {
                    if (v) {
                      c.rgb.nightStart = "22:00";
                      c.rgb.nightEnd = "07:00";
                      if (!c.rgb.nightBrightness) c.rgb.nightBrightness = 0.3;
                    } else {
                      c.rgb.nightStart = "";
                      c.rgb.nightEnd = "";
                    }
                  })
                }
              />
              {!!rgbCfg.nightStart && !!rgbCfg.nightEnd && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-dim-sm">{t("common.starts")}</span>
                    <input
                      type="time"
                      value={rgbCfg.nightStart}
                      onChange={(e) => save((c) => (c.rgb.nightStart = e.target.value))}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-dim-sm">{t("common.ends")}</span>
                    <input
                      type="time"
                      value={rgbCfg.nightEnd}
                      onChange={(e) => save((c) => (c.rgb.nightEnd = e.target.value))}
                      className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                    />
                  </label>
                  <div className="col-span-2">
                    <Slider
                      label={t("common.night-brightness-cap")}
                      min={0}
                      max={100}
                      step={5}
                      value={Math.round(rgbCfg.nightBrightness * 100)}
                      format={(v) => `${v}%`}
                      onChange={(v) => save((c) => (c.rgb.nightBrightness = v / 100))}
                    />
                  </div>
                </div>
              )}
              <Toggle
                label={t("common.flash-on-track-change")}
                description={t("common.pulse-every-device-once-when-the-os-media-sessio")}
                checked={rgbCfg.trackFlashMs > 0}
                onChange={(v) => save((c) => (c.rgb.trackFlashMs = v ? 400 : 0))}
              />
              {rgbCfg.trackFlashMs > 0 && (
                <div className="mt-3">
                  <Slider
                    label={t("common.flash-duration")}
                    min={150}
                    max={1000}
                    step={50}
                    value={rgbCfg.trackFlashMs}
                    format={(v) => `${v} ms`}
                    onChange={(v) => save((c) => (c.rgb.trackFlashMs = v))}
                  />
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card
            anchor="lighting-mode"
            title={t("common.lighting-mode")}
            right={
              <span className="inline-flex items-center gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  {t(
                    activeMode?.group === "animation"
                      ? "lighting.animated-mode"
                      : "lighting.reactive-mode",
                  )}
                </span>
                {!rgbCfg.enabled && <Chip tone="warn">{t("common.off")}</Chip>}
              </span>
            }
          >
            <ModePicker
              mode={rgbCfg.mode}
              staticColor={rgbCfg.staticColor}
              liveColor={liveWallpaperColor}
              speed={rgbCfg.animationSpeed}
              brightness={rgbCfg.mixer.brightness}
              saturation={rgbCfg.mixer.saturation}
              cycleSpread={rgbCfg.cycleSpread}
              waveDirection={rgbCfg.waveDirection}
              onPick={(m) => save((c) => (c.rgb.mode = m))}
            />


            <div className="mt-5 space-y-1 border-t border-[var(--line)] pt-4">
              <Section
                title={
                  activeMode
                    ? t("common.{mode}-options", { mode: t(activeMode.label) })
                    : t("common.mode-options")
                }
                defaultOpen
              >
              <div className="space-y-1">
                {(rgbCfg.mode === "static" || rgbCfg.mode === "breathe") && (
                  <div className="pb-2">
                    <ColorInput
                      label={t(
                        rgbCfg.mode === "static"
                          ? "lighting.static-color"
                          : "lighting.breath-color",
                      )}
                      value={rgbCfg.staticColor}
                      onChange={(v) => save((c) => (c.rgb.staticColor = v))}
                    />
                  </div>
                )}
                {rgbCfg.mode === "audioReactive" && (
                  <div className="mb-2">
                    <InfoNote>
                      {t("common.colors-follow-the")}{" "}
                      <b className="text-[var(--text)]">
                        {t("common.wallpaper-accent")}
                      </b>{" "}
                      {t("common.the-dominant-on-screen-tone-so-the-lights-match")}
                    </InfoNote>
                  </div>
                )}
                {rgbCfg.mode === "zone" && (
                  <div className="mb-2">
                    <InfoNote>
                      {t("common.draw-zones-on-the-wallpaper-tab-each-zone-can-be")}
                    </InfoNote>
                  </div>
                )}
                {rgbCfg.mode === "cycle" && (
                  <Slider
                    label={t("common.rainbow-spread")}
                    value={rgbCfg.cycleSpread}
                    min={30}
                    max={720}
                    step={10}
                    onChange={(v) => save((c) => (c.rgb.cycleSpread = v))}
                    format={(v) => `${Math.round(v)}°`}
                  />
                )}
                {rgbCfg.mode === "wave" && (
                  <div className="py-2.5">
                    <div className="kicker mb-2">{t("common.direction")}</div>
                    <Segmented
                      label={t("common.wave-direction")}
                      options={[
                        { id: "1", label: t("common.forward") },
                        { id: "-1", label: t("common.reverse") },
                      ]}
                      value={String(rgbCfg.waveDirection)}
                      onChange={(v) => save((c) => { c.rgb.waveDirection = Number(v) as 1 | -1; })}
                    />
                  </div>
                )}
                {rgbCfg.mode === "audioReactive" && (
                  <>
                    <div className="py-2.5">
                      <div className="kicker mb-2">{t("common.audio-source")}</div>
                      <Segmented
                        label={t("common.audio-source")}
                        options={[
                          { id: "system", label: t("common.system-audio") },
                          { id: "microphone", label: t("common.microphone") },
                        ]}
                        value={rgbCfg.audioSource}
                        onChange={(v) => save((c) => { c.rgb.audioSource = v; })}
                      />
                    </div>
                    <AudioLevelMeter />
                    <Slider
                      label={t("common.audio-sensitivity")}
                      min={0.1}
                      max={3}
                      step={0.1}
                      value={rgbCfg.audioSensitivity}
                      format={(v) => `${v.toFixed(1)}x`}
                      onChange={(v) => save((c) => (c.rgb.audioSensitivity = v))}
                    />
                    <Slider
                      label={t("common.audio-smoothing")}
                      min={0}
                      max={0.95}
                      step={0.05}
                      value={rgbCfg.audioSmoothing}
                      format={(v) => (v === 0 ? t("common.snap") : `${Math.round(v * 100)}%`)}
                      onChange={(v) => save((c) => (c.rgb.audioSmoothing = v))}
                    />
                  </>
                )}
                {isAnimated && (
                  <Slider
                    label={t("common.animation-speed")}
                    min={0.1}
                    max={5}
                    step={0.1}
                    value={rgbCfg.animationSpeed}
                    format={(v) => `${v.toFixed(1)}×`}
                    onChange={(v) => save((c) => (c.rgb.animationSpeed = v))}
                  />
                )}
                {!isAnimated && (
                  <Slider
                    label={t("common.transition-smoothing")}
                    min={0}
                    max={0.95}
                    step={0.05}
                    value={rgbCfg.mixer.smoothing}
                    format={(v) => (v === 0 ? t("common.snap") : `${Math.round(v * 100)}%`)}
                    onChange={(v) => save((c) => (c.rgb.mixer.smoothing = v))}
                  />
                )}
              </div>
              </Section>

              <Section title={t("common.output-mixer")} defaultOpen>
              <div className="space-y-1">
                <Slider
                  label={t("common.brightness")}
                  min={0.1}
                  max={1.5}
                  step={0.05}
                  value={rgbCfg.mixer.brightness}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => save((c) => (c.rgb.mixer.brightness = v))}
                />
                <Slider
                  label={t("common.saturation")}
                  min={0}
                  max={2}
                  step={0.05}
                  value={rgbCfg.mixer.saturation}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => save((c) => (c.rgb.mixer.saturation = v))}
                />
                <Slider
                  label={t("common.gamma")}
                  min={0.4}
                  max={2.5}
                  step={0.05}
                  value={rgbCfg.mixer.gamma}
                  format={(v) => v.toFixed(2)}
                  onChange={(v) => save((c) => (c.rgb.mixer.gamma = v))}
                />

                {!isAnimated && (
                  <Select
                    label={t("common.led-write-interval")}
                    value={String(rgbCfg.minUpdateMs)}
                    options={presetOptions(
                      WRITE_INTERVAL_OPTIONS,
                      String(rgbCfg.minUpdateMs),
                      (v) => `${v} ms`,
                    )}
                    onChange={(v) => save((c) => (c.rgb.minUpdateMs = Number(v)))}
                  />
                )}
              </div>
              </Section>
            </div>

          </Card>
        </div>
      </div>
    </div>
  );
}