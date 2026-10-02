import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Toggle, Slider, Btn, ColorInput, Section, Segmented, InfoNote, ItemTitle, IconBox } from "../ui";
import { DeviceRow } from "../DeviceRow";
import { LiveStage } from "../lighting/LiveStage";
import { ModePicker } from "../lighting/ModePicker";
import { IconCheck, IconRefresh, IconZap, IconPlus, IconTrash } from "../icons";
import { RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import { rgbToHex } from "../../utilities";
import type { AudioLevel, DeviceColor, RgbMode } from "@shared/types";
import { t } from "../../i18n";

export default function RgbTab() {
  // Perf: deviceColors and audioLevel both update at frame rate. Subscribing
  // the whole tab to them re-renders ~35x/sec; both consumers only need the
  // first device's representative color (a slow-moving value), so mirror
  // them into state at 2Hz instead.
  const { cfg, rgb, save } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      save: s.save,
    })),
  );
  const [audioLevel, setAudioLevelLive] = useState(useStore.getState().audioLevel);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let pending: AudioLevel | null = null;
    const un = useStore.subscribe((s, prev) => {
      if (s.audioLevel !== prev.audioLevel) pending = s.audioLevel;
      if (timer == null) {
        timer = setInterval(() => {
          if (pending) {
            setAudioLevelLive(pending);
            pending = null;
          }
        }, 500);
      }
    });
    return () => {
      un();
      if (timer) clearInterval(timer);
    };
  }, []);
  const [deviceColors, setDeviceColorsLive] = useState<Record<number, DeviceColor>>(
    useStore.getState().deviceColors,
  );
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let dirty = false;
    const un = useStore.subscribe((s, prev) => {
      if (s.deviceColors !== prev.deviceColors) dirty = true;
      if (timer == null) {
        timer = setInterval(() => {
          if (dirty) {
            setDeviceColorsLive(useStore.getState().deviceColors);
            dirty = false;
          }
        }, 500);
      }
    });
    return () => {
      un();
      if (timer) clearInterval(timer);
    };
  }, []);
  const [profileNaming, setProfileNaming] = useState(false);
  const [profileNameVal, setProfileNameVal] = useState("");
  const promptProfileName = () => {
    setProfileNaming(true);
    setProfileNameVal(`Profile ${(cfg?.rgb.profiles.length ?? 0) + 1}`);
    return null; // commit happens via the inline form below
  };
  // Hooks must run unconditionally — derive everything after they complete.
  if (!cfg) return null;
  const rgbCfg = cfg.rgb;
  const isAnimated = (ANIMATION_MODES as ReadonlySet<RgbMode>).has(rgbCfg.mode);

  const ledTotal = rgb.devices.reduce((n, d) => n + d.leds, 0);
  const activeLeds = rgb.devices
    .filter((d) => !rgbCfg.excludedDevices.includes(d.id))
    .reduce((n, d) => n + d.leds, 0);
  const mutedCount = rgb.devices.filter((d) =>
    rgbCfg.excludedDevices.includes(d.id),
  ).length;
  const activeMode = RGB_MODES.find((m) => m.id === rgbCfg.mode);
  const liveWallpaperColor = Object.values(deviceColors)[0]?.rgb ?? null;

  return (
    <div className="stagger space-y-5">
      {/* ---- stage: state, what is driving it, and the master switch ---- */}
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

      {/* `@container`: the columns below sit in a layout whose width has
          nothing to do with the viewport, so viewport breakpoints squeezed
          them once the window was maximized. Left: what the lights run ON and
          WHEN. Right: how they look. */}
      <div className="@container grid items-start gap-5 lg:grid-cols-[1fr_1.15fr]">
        <div className="space-y-5">
          <Card
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
            {rgb.connected ? (
              <ul className="space-y-2">
                {rgb.devices.map((d) => {
                  const muted = rgbCfg.excludedDevices.includes(d.id);
                  return (
                    <DeviceRow
                      key={d.id}
                      device={d}
                      live={deviceColors[d.id]}
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
            ) : (
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
                <Btn onClick={() => useStore.getState().load()}>
                  <IconRefresh className="h-4 w-4" />
                  {t("common.retry")}
                </Btn>
              </div>
            )}
            {/* Muted devices stay listed — the engine simply stops writing to
                them, so the count is worth stating plainly. */}
            {rgb.connected && mutedCount > 0 && (
              <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.{n}-devices-are-muted-muted-hardware-keeps-its-l", { n: mutedCount })}
              </p>
            )}
          </Card>

          {/* Automation used to live inside the Devices card, which made one
              panel answer "what is plugged in" and "when does it run" at once.
              They are different questions with different urgency — a lighting
              rule you cannot find is worse than a device you cannot name — so
              they get their own card. */}
          <Card title={t("common.automation")}>
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
                <Slider
                  label={t("common.idle-timeout")}
                  min={30}
                  max={3600}
                  step={30}
                  value={rgbCfg.idleTimeoutSec}
                  format={(v) => {
                    if (v < 60) return `${v}s`;
                    const m = Math.floor(v / 60);
                    const s = v % 60;
                    return s > 0 ? `${m}m ${s}s` : `${m} min`;
                  }}
                  onChange={(v) => save((c) => (c.rgb.idleTimeoutSec = v))}
                />
                <Slider
                  label={t("common.check-interval")}
                  min={1}
                  max={60}
                  step={1}
                  value={rgbCfg.idleCheckIntervalSec}
                  format={(v) => `${v}s`}
                  onChange={(v) => save((c) => (c.rgb.idleCheckIntervalSec = v))}
                />
              </>
            )}

            <div className="mt-3 border-t border-[var(--line)] pt-3">
              <Toggle
                label={t("common.night-dimming")}
                description="Cap LED brightness during a daily window (e.g. 22:00 to 07:00) so the lights don't glare in the dark."
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
            title={t("common.lighting-mode")}
            right={
              /* Brightness and speed already read as two large figures on the
                 stage above, so repeating them here in small type was noise.
                 What is worth carrying at this depth is which kind of mode is
                 running — that is the thing you scroll back up to check. */
              <span className="inline-flex items-center gap-2.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-[var(--text-faint)]">
                  {t(
                    activeMode?.group === "animation"
                      ? "lighting.animated-mode"
                      : "lighting.reactive-mode",
                  )}
                </span>
                {!rgbCfg.enabled && (
                  <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-px font-mono text-[10px] uppercase text-amber-300">{t("common.off")}</span>
                )}
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
              audio={audioLevel}
              cycleSpread={rgbCfg.cycleSpread}
              waveDirection={rgbCfg.waveDirection}
              onPick={(m) => save((c) => (c.rgb.mode = m))}
            />

            {/* ---- mode-specific options + mixer ----
                The mode story reads top-down: pick a mode, tune it, then shape
                the output. Profiles used to sit between the picker and the
                options, which split the story in half. */}
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
                    <div className="py-2.5">
                      <div className="kicker mb-2">{t("common.audio-level")}</div>
                      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--panel)]">
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75"
                          style={{
                            width: `${Math.round(audioLevel.volume * 100)}%`,
                            // The transient is a decaying envelope, not a flag,
                            // so the flash fades with the hit instead of
                            // snapping off on the next frame.
                            background:
                              audioLevel.pulse > 0.05
                                ? "rgb(var(--glow))"
                                : "linear-gradient(90deg, rgb(var(--glow)), rgb(167 139 250))",
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
                        <div className="mt-1 truncate text-[11px] text-[var(--text-dim)]" title={audioLevel.deviceName}>
                          {audioLevel.deviceName}
                        </div>
                      )}
                    </div>
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
                      format={(v) => (v === 0 ? "snap" : `${Math.round(v * 100)}%`)}
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
                    format={(v) => (v === 0 ? "snap" : `${Math.round(v * 100)}%`)}
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
                  <Slider
                    label={t("common.min-update-interval")}
                    min={30}
                    max={1000}
                    step={10}
                    value={rgbCfg.minUpdateMs}
                    format={(v) => `${v} ms`}
                    onChange={(v) => save((c) => (c.rgb.minUpdateMs = v))}
                  />
                )}
              </div>
              </Section>
            </div>

            {/* ---- profiles: save/apply named snapshots, also in the tray.
                Last, because a snapshot is something you take once the rest is
                how you want it. */}
            <div className="mt-5 border-t border-[var(--line)] pt-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <ItemTitle>{t("common.profiles")}</ItemTitle>
                  <div className="mt-0.5 text-dim-sm">
                    {t("common.save-the-current-mode-color-and-speed-as-a-snaps")}
                  </div>
                </div>
                {profileNaming ? (
                  <form
                    className="flex items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const name = profileNameVal.trim();
                      if (name) {
                        save((c) => {
                          c.rgb.profiles = [
                            ...c.rgb.profiles.filter((p) => p.name !== name),
                            {
                              name,
                              mode: rgbCfg.mode,
                              staticColor: rgbCfg.staticColor,
                              animationSpeed: rgbCfg.animationSpeed,
                            },
                          ];
                        });
                      }
                      setProfileNaming(false);
                    }}
                  >
                    <input
                      autoFocus
                      value={profileNameVal}
                      onChange={(e) => setProfileNameVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && setProfileNaming(false)}
                      placeholder={t("common.profile-name")}
                      className="w-36 rounded-lg border border-[rgb(var(--glow)/0.4)] bg-[var(--panel-strong)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] outline-none"
                    />
                    <Btn variant="primary" onClick={() => {}}>
                      <IconCheck className="h-4 w-4" />
                      {t("common.save")}
                    </Btn>
                  </form>
                ) : (
                  <Btn onClick={promptProfileName}>
                    <IconPlus className="h-4 w-4" />
                    {t("common.save-current")}
                  </Btn>
                )}
              </div>
              {(rgbCfg.profiles?.length ?? 0) === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--line-strong)] px-4 py-5 text-center text-xs text-[var(--text-faint)]">
                  {t("common.no-profiles-yet-tune-the-lights-then-save-the-lo")}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {rgbCfg.profiles.map((p) => {
                    const activeNow =
                      p.mode === rgbCfg.mode &&
                      p.staticColor.join() === rgbCfg.staticColor.join() &&
                      Math.abs(p.animationSpeed - rgbCfg.animationSpeed) < 0.01;
                    return (
                      <div
                        key={p.name}
                        className={`group flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-2 ${
                          activeNow
                            ? "border border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)]"
                            : "border border-[var(--line)] bg-[var(--panel-strong)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <button
                          onClick={() =>
                            save((c) => {
                              const src = c.rgb.profiles.find((x) => x.name === p.name);
                              if (!src) return;
                              c.rgb.mode = src.mode;
                              c.rgb.staticColor = src.staticColor;
                              c.rgb.animationSpeed = src.animationSpeed;
                            })
                          }
                          className="flex items-center gap-2"
                          title={`Apply "${p.name}"`}
                        >
                          <span
                            className="h-4 w-4 shrink-0 rounded-full border border-white/20"
                            style={{ background: rgbToHex(p.staticColor) }}
                          />
                          <span className="text-xs font-semibold text-[var(--text)]">{p.name}</span>
                          <span className="font-mono text-[10px] text-[var(--text-faint)]">
                            {p.mode === "audioReactive" ? "audio" : p.mode} · {p.animationSpeed.toFixed(1)}×
                          </span>
                        </button>
                        <button
                          aria-label={`Delete profile ${p.name}`}
                          onClick={() => {
                            save((c) => {
                              c.rgb.profiles = c.rgb.profiles.filter(
                                (x) => x.name !== p.name,
                              );
                            });
                            useStore
                              .getState()
                              .undoDelete(`Deleted lighting profile "${p.name}"`, (c) => {
                                c.rgb.profiles.push(p);
                              });
                          }}
                          className="hidden text-[var(--text-faint)] transition-colors hover:text-red-400 group-hover:block"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}