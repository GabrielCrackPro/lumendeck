import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../../store";
import { Card, Toggle, Slider, Btn, ColorInput, Dropdown, Section, Segmented, InfoNote, ItemTitle, IconBox } from "../ui";
import { DeviceRow, deviceName } from "../DeviceRow";
import { KeyboardPreview } from "../KeyboardPreview";
import { ModePreview } from "../ModePreview";
import { IconCheck, IconRefresh, IconZap, IconWave, IconPlus, IconTrash } from "../icons";
import { RGB_MODES, ANIMATION_MODES } from "@shared/constants";
import { rgbToHex } from "../../utilities";
import type { AudioLevel, DeviceColor, RgbMode } from "@shared/types";
import { t } from "../../i18n";

/** Per-mode line icon. */
function ModeIcon({ mode, className }: { mode: RgbMode; className?: string }) {
  const common = { className, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24" };
  switch (mode) {
    case "ambient":
      return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2" /></svg>;
    case "zone":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 3v18M3 12h9" /></svg>;
    case "pulse":
      return <svg {...common}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
    case "static":
      return <svg {...common}><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" /></svg>;
    case "cycle":
      return <svg {...common}><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4" /></svg>;
    case "wave":
      return <svg {...common}><path d="M2 12c2.5-5 5.5-5 8 0s5.5 5 8 0M2 12c2.5 5 5.5 5 8 0" /></svg>;
    case "breathe":
      return <svg {...common}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7" opacity="0.5" /><circle cx="12" cy="12" r="10" opacity="0.2" /></svg>;
    case "audioReactive":
      return <svg {...common}><path d="M3 12v-2m4 2v-4m4 4v-6m4 6v-4m4 4v-2" /><path d="M3 12h18" /></svg>;
  }
}

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
    <div className="stagger space-y-6">
      {/* ---- hero: live stage ---- */}
      <Card title={t("common.live-stage")}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <KeyboardPreview />
          <div className="flex min-w-0 flex-col justify-between gap-4">
            <span
              className={`relative block h-20 w-full overflow-hidden rounded-xl border ${
                rgbCfg.enabled ? "border-[rgb(var(--glow)/0.4)]" : "border-[var(--line)]"
              }`}
            >
              <ModePreview
                mode={rgbCfg.mode}
                staticColor={rgbCfg.staticColor}
                liveColor={liveWallpaperColor}
                speed={rgbCfg.animationSpeed}
                brightness={rgbCfg.mixer.brightness}
                saturation={rgbCfg.mixer.saturation}
                active={rgbCfg.enabled}
                audioVolume={audioLevel.volume}
                cycleSpread={rgbCfg.cycleSpread}
                waveDirection={rgbCfg.waveDirection}
              />
              <span className="absolute inset-0 bg-[linear-gradient(180deg,rgb(255_255_255/0.08),transparent_40%)]" />
              <span className="absolute bottom-2 left-3 font-mono text-[10px] uppercase tracking-wider text-[rgb(255_255_255/0.75)]">
                {t(rgbCfg.enabled ? "lighting.active" : "lighting.sync-off")}
              </span>
            </span>
            <div>
              <div className="kicker">
                {t(
                  activeMode?.group === "animation"
                    ? "lighting.animated-mode"
                    : "lighting.reactive-mode",
                )}
              </div>
              <div className="mt-0.5 text-lg font-semibold text-[var(--text)]">
                {activeMode ? t(activeMode.label) : rgbCfg.mode}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] text-[var(--text-dim)]">
                {t("common.{n}-devices-{leds}-leds", {
                  n: rgb.devices.length,
                  leds: ledTotal.toLocaleString(),
                })}
              </div>
              <label className="mt-2 flex items-center gap-2">
                <span className="kicker shrink-0">{t("common.accent-from")}</span>
                <Dropdown
                  className="min-w-0 flex-1"
                  value={rgbCfg.accentDevice ?? ""}
                  options={[
                    { id: "", label: t("common.auto-keyboard-first") },
                    { id: -1, label: t("common.off-static-color") },
                    ...rgb.devices.map((d) => ({
                      id: d.id,
                      label: deviceName(d, rgbCfg.deviceNames),
                    })),
                  ]}
                  onChange={(v) =>
                    save((c) => {
                      c.rgb.accentDevice = v === "" ? null : Number(v);
                    })
                  }
                />
              </label>
            </div>
            <Toggle
              label={t("common.rgb-sync-enabled")}
              checked={rgbCfg.enabled}
              onChange={(v) => save((c) => (c.rgb.enabled = v))}
            />
            <Toggle
              label={t("common.ui-follows-lights")}
              checked={cfg?.general.accentLive ?? false}
              onChange={(v) => save((c) => (c.general.accentLive = v))}
            />
          </div>
        </div>
      </Card>

      {/* `@container`: the mode cards below sit in a narrow column whose
          width has nothing to do with the viewport, so viewport breakpoints
          squeezed them once the window was maximized. Left column: hardware
          + automation (what the lights run ON). Right column: look (mode,
          options, mixer, profiles). */}
      <div className="@container grid gap-5 lg:grid-cols-[1fr_1.15fr]">
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
            <div className="mt-5 space-y-3.5 text-sm text-[var(--text-dim)]">
              <div className="flex items-start gap-3 panel-inset p-3.5">
                {/* IconBox already carries this amber plate; it was hand-rolled
                    here at 32px with rounded-xl, which under the new scale is
                    almost a circle, and at a size the shared component does not
                    use. */}
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
          {/* Everything that governs WHEN lights are on/off lives together:
              idle, night window, track flash — behavior over look. */}
          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <div className="kicker mb-1">{t("common.automation")}</div>
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
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card
          title={t("common.lighting-mode")}
          right={
            <span className="inline-flex items-center gap-2.5 font-mono text-[10px] tracking-wide">
              <span className="text-[var(--text-faint)]">
                {t("common.{n}-bright", {
                  n: Math.round(rgbCfg.mixer.brightness * 100),
                })}
              </span>
              <span className="h-0.5 w-0.5 rounded-full bg-[var(--line-strong)]" />
              {isAnimated ? (
                <span className="inline-flex items-center gap-1.5 text-[rgb(var(--glow))]">
                  <IconWave className="h-4 w-4" />
                  {rgbCfg.animationSpeed.toFixed(1)}×
                </span>
              ) : (
                <span className="text-[var(--text-faint)]">
                  {rgbCfg.mixer.smoothing === 0
                    ? t("common.snap")
                    : t("common.{n}-smooth", {
                        n: Math.round(rgbCfg.mixer.smoothing * 100),
                      })}
                </span>
              )}
              {!rgbCfg.enabled && (
                <span className="rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-px uppercase text-amber-300">{t("common.off")}</span>
              )}
            </span>
          }
        >
          {(["reactive", "animation"] as const).map((group, gi) => (
            <div key={group} className={gi > 0 ? "mt-5 border-t border-[var(--line)] pt-4" : ""}>
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <span className="kicker">
                  {t(group === "reactive" ? "lighting.reactive-to-wallpaper" : "lighting.animated")}
                </span>
                <span className="font-mono text-[9.5px] text-[var(--text-faint)]">
                  {t(
                    group === "reactive"
                      ? "lighting.color-follows-the-screen"
                      : "lighting.self-driven-motion",
                  )}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 @[22rem]:grid-cols-2 @[38rem]:grid-cols-4">
                {RGB_MODES.filter((m) => m.group === group).map((m) => {
                  const active = rgbCfg.mode === m.id;
                  return (
                    <button
                      key={m.id}
                      onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                      title={t(m.hint)}
                      className={`group flex w-full flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 active:scale-[0.98] ${
                        active
                          ? "border-[rgb(var(--glow)/0.6)] shadow-[0_8px_28px_-10px_rgb(var(--glow)/0.55)] ring-2 ring-[rgb(var(--glow)/0.25)]"
                          : "border-[var(--line)] hover:border-[var(--line-strong)] hover:shadow-[0_4px_16px_-8px_rgb(var(--glow)/0.35)]"
                      }`}
                    >
                      {/* Live strip preview as a fixed band — in normal flow,
                          so the text below can never overlap it. */}
                      <span className="relative block h-12 w-full shrink-0">
                        <ModePreview
                          mode={m.id as RgbMode}
                          staticColor={rgbCfg.staticColor}
                          liveColor={liveWallpaperColor}
                          speed={rgbCfg.animationSpeed}
                          brightness={rgbCfg.mixer.brightness}
                          saturation={rgbCfg.mixer.saturation}
                          active={active}
                          audioVolume={audioLevel.volume}
                          cycleSpread={rgbCfg.cycleSpread}
                          waveDirection={rgbCfg.waveDirection}
                        />
                        <span className="pointer-events-none absolute inset-0 rounded-t-xl ring-1 ring-inset ring-[rgb(255_255_255/0.06)]" />
                        {active && (
                          <span className="absolute right-1.5 top-1.5 rounded-md bg-[rgb(var(--glow))] px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-black/85">
                            {t("common.on")}
                          </span>
                        )}
                      </span>
                      {/* Text row: icon + label + hint, normal flow, one line. */}
                      <span
                        className={`flex w-full items-center gap-2 border-t px-2.5 py-2 transition-colors ${
                          active
                            ? "border-[rgb(var(--glow)/0.3)] bg-[rgb(var(--glow)/0.08)]"
                            : "border-transparent bg-[var(--panel-strong)] group-hover:bg-[var(--panel)]"
                        }`}
                      >
                        <ModeIcon
                          mode={m.id as RgbMode}
                          className={`h-4 w-4 shrink-0 ${
                            active ? "text-[rgb(var(--glow))]" : "text-[var(--text-faint)] group-hover:text-[var(--text-dim)]"
                          }`}
                        />
                        <span className="min-w-0">
                          <span
                            className={`block truncate text-[12.5px] font-semibold leading-tight ${
                              active ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
                            }`}
                          >
                            {t(m.label)}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {/* ---- profiles: save/apply named snapshots, also exposed in tray ---- */}
          <div className="mt-6 border-t border-[var(--line)] pt-4">
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
                      }`
                    }
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
          {/* ---- mode-specific options + mixer: everything keyed to the
              active mode lives under one header, in one place ---- */}
          <div className="space-y-1">
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

            {/* output mixer */}
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
        </Card>
      </div>
      </div>
    </div>
  );
}