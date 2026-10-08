import { useShallow } from "zustand/react/shallow";
import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { Card, Chip, ChipButton, Btn, DisplaysCard, IconBox, RefreshBtn, ItemTitle, MINI_BTN } from "../ui";
import { ConfigPickerModal } from "../ConfigPickerModal";
import { useConfigPicker } from "../useConfigPicker";
import { visibleProfiles, profileSummary, attentionItems } from "../overviewCards";
import { ACCENT_SOURCE_LABELS } from "../../accent";
import { useAccent } from "../../useAccent";
import SystemCard from "../SystemCard";
import { ledCounts } from "../deviceList";
import { versionLabel } from "../buildIdentity";
import { IconBulb, IconImage, IconSticker, IconLayers, IconWave, IconChevronRight, IconSpinner, IconCheck } from "../icons";
import { SHADERS, ANIMATION_MODES } from "@shared/constants";
import { basename } from "../../utilities";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { t } from "../../i18n";
import MediaCardBody from "../overview/MediaCard";
import EngineCard from "../overview/EngineCard";
import ShortcutsCard from "../overview/ShortcutsCard";
import {
  useLastChange,
  CHANGE_LABEL,
  recencyText,
  useNow,
  useGreetingKey,
  useFps,
  useAudioVars,
} from "../overview/hooks";

const GREETING_KEYS = {
  "overview.up-late": "overview.up-late-{name}",
  "overview.good-morning": "overview.good-morning-{name}",
  "overview.good-afternoon": "overview.good-afternoon-{name}",
  "overview.good-evening": "overview.good-evening-{name}",
} as const;

export default function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  const { cfg, rgb, wallpaperPaused, save, media } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      wallpaperPaused: s.wallpaperPaused,
      save: s.save,
      media: s.media,
    })),
  );
  const saving = useStore((s) => s.saving);
  const [accountName, setAccountName] = useState("");
  const [allDevices, setAllDevices] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api
      .accountName()
      .then((name) => {
        if (!disposed) setAccountName(name);
      })
      .catch((error: unknown) => {
        console.warn(
          "[overview] account name unavailable; using the unnamed greeting",
          error,
        );
      });
    return () => {
      disposed = true;
    };
  }, []);
  const { pending, run } = usePending();
  const fps = useFps();
  const accentFrom = useAccent().source;
  const audio = useAudioVars(!!media?.playing);

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const counts = ledCounts(rgb.devices, cfg.rgb.excludedDevices);
  const ledActive = counts.active;
  const excluded = new Set(cfg.rgb.excludedDevices);
  const isAnimatedMode = (ANIMATION_MODES as ReadonlySet<string>).has(cfg.rgb.mode);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const playlistOn = (cfg.playlists ?? []).some((p) => p.enabled);
  const picker = useConfigPicker();
  const lastChange = useLastChange([
    {
      value: `${cfg?.wallpaper.kind}|${cfg?.wallpaper.source ?? ""}`,
      labelKey: CHANGE_LABEL.wallpaper,
    },
    {
      value: media ? `${media.title}|${media.artist}` : "",
      labelKey: CHANGE_LABEL.track,
    },
    { value: picker.activeId ?? "", labelKey: CHANGE_LABEL.profile },
  ]);
  const now = useNow(lastChange != null);
  const profileList = visibleProfiles(picker.scenes, picker.activeId);
  const wallpaperName =
    cfg.wallpaper.kind === "shader"
      ? (SHADERS.find((s) => s.id === cfg.wallpaper.source)?.label ?? cfg.wallpaper.source)
      : cfg.wallpaper.source
        ? basename(cfg.wallpaper.source)
        : t("common.nothing-applied");

  const togglePause = () => {
    if (!cfg) return;
    save((c) => (c.general.wallpaperEnabled = !c.general.wallpaperEnabled));
  };

  const greetingKey = useGreetingKey();
  const greeting = accountName
    ? t(GREETING_KEYS[greetingKey], { name: accountName })
    : t(greetingKey);
  const attention = attentionItems({
    rgbConnected: rgb.connected,
    wallpaperPaused: paused,
    lightingEnabled: cfg.rgb.enabled,
  });

  return (
    <div className="stagger space-y-5">
      { }
      <header className="min-w-0">
        {

 }
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="kicker">{t("overview.at-a-glance")}</span>
          <span aria-hidden className="text-[var(--text-faint)]">·</span>
          {

 }
          <span className="rounded-md border border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.08)] px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--glow))]">
            {t("overview.engine", { v: versionLabel(__APP_VERSION__) })}
          </span>
        </div>

        {

 }
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="min-w-0 text-[clamp(1.5rem,3vw,2.125rem)] font-semibold leading-[1.1] tracking-[-0.035em] text-[var(--text)]">
              {greeting}
            </h1>
            {

 }
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshBtn />
          </div>
        </div>

        {



 }
        <div className="mt-2.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--text-faint)]">
          {attention.length === 0 ? (
            <span className="flex items-center gap-1.5 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {t("overview.all-in-sync")}
            </span>
          ) : (
            attention.map((item) => (
              <ChipButton
                key={item.id}
                tone="warn"
                disabled={saving && item.action.kind !== "navigate"}
                title={
                  item.action.kind === "navigate"
                    ? t("common.open-the-tab-that-fixes-this")
                    : t("common.turn-the-lighting-back-on")
                }
                onClick={() => {
                  if (item.action.kind === "navigate") onNavigate(item.action.tab);
                  else save((c) => (c.rgb.enabled = true));
                }}
              >
                {t(item.key)}
              </ChipButton>
            ))
          )}

          {

 }
          <Chip tone="idle">
            {t(ACCENT_SOURCE_LABELS[accentFrom])}
          </Chip>

          {lastChange && (
            <span className="text-[var(--text-dim)]">
              {t(lastChange.labelKey, { recency: recencyText(lastChange.at, now) })}
            </span>
          )}

          {

 }
          <span className="tabular-nums text-[var(--text-faint)]">
            {fps > 0 ? t("common.{n}-fps", { n: fps }) : t("common.fps-warming-up")}
          </span>
        </div>
      </header>
      { }
      <div
        ref={audio.ref}
        style={audio.style}
        className="grid min-w-0 items-start gap-5 xl:grid-cols-12"
      >
        {
 }
        <Card
          title={t("overview.now-playing")}
          icon={<IconWave />}
          className="xl:col-span-5"
          noShadow
          right={
            <Chip tone={media ? (media.playing ? "ok" : "idle") : "idle"} pulse={!!media?.playing}>
              {t(
                media
                  ? media.playing
                    ? "overview.playing"
                    : "overview.paused-track"
                  : "overview.idle",
              )}
            </Chip>
          }
        >
          <MediaCardBody
            cfg={cfg}
            paused={paused}
            wallpaperName={wallpaperName}
            media={media}
            onTogglePause={togglePause}
            onChange={() => onNavigate("wallpaper")}
          />
        </Card>

        {

 }
        <EngineCard
          cfg={cfg}
          rgb={rgb}
          counts={counts}
          save={save}
          nightOn={nightOn}
          idleOn={idleOn}
          isAnimatedMode={isAnimatedMode}
          excluded={excluded}
          allDevices={allDevices}
          onAllDevices={setAllDevices}
        />
      </div>

      { }
      {

 }
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <DisplaysCard compact />
        </div>
        <div className="xl:col-span-5">
          <Card title={t("overview.stickers-and-desktop-widgets")} icon={<IconSticker />} right={
            stickers.length > 0 ? (
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {t("common.{visible}-{total}-visible", {
                  visible: visibleStickers.length,
                  total: stickers.length,
                })}
              </span>
            ) : undefined
          }>
            {stickers.length === 0 ? (
              <button
                onClick={() => onNavigate("stickers")}
                className="flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-[var(--line-strong)] py-6 text-[var(--text-faint)] hover-glow"
              >
                <IconSticker className="h-5 w-5" />
                <span className="text-xs font-semibold">{t("common.place-your-first-sticker")}</span>
              </button>
            ) : (
              <div className="space-y-1.5">
                {stickers.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    title={t(s.visible ? "overview.hide-this-sticker" : "overview.show-this-sticker")}
                    onClick={() => {
                      void run(`sticker-${s.id}`, () =>
                        api.updateSticker({ ...s, visible: !s.visible }),
                      );
                    }}
                    aria-busy={pending.has(`sticker-${s.id}`) || undefined}
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-2 text-left transition-all hover:border-[var(--line-strong)] active:scale-[0.99]"
                  >
                    <img
                      src={s.url}
                      alt=""
                      className={`h-8 w-8 shrink-0 rounded-md border border-[var(--line)] bg-black/30 object-contain transition-opacity ${
                        s.visible ? "" : "opacity-35 grayscale"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13px] font-medium ${
                          s.visible ? "text-[var(--text)]" : "text-[var(--text-faint)]"
                        }`}
                      >
                        {s.name}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--text-faint)]">
                        {`${Math.round(s.w)}×${Math.round(s.h)} · ${t(s.onTop ? "overview.on-top" : "overview.wallpaper-layer")}`}
                      </div>
                    </div>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        s.visible
                          ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]"
                          : "bg-[var(--text-faint)]"
                      }`}
                    />
                  </button>
                ))}
                {stickers.length > 4 && (
                  <button
                    onClick={() => onNavigate("stickers")}
                    className="px-1 text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                  >
                    {t("common.{n}-more-manage-stickers", { n: stickers.length - 4 })}
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      {



 }
      <SystemCard />

      {


 }
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-12">
        <Card
          title={t("common.profiles")}
          icon={<IconLayers />}
          className="xl:col-span-7"
          right={
            picker.scenes.length > 0 ? (
              <button onClick={() => onNavigate("general")} className={MINI_BTN}>
                {t("common.manage")}
              </button>
            ) : undefined
          }
        >
          {picker.scenes.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--line-strong)] px-6 py-8 text-center">
              <IconLayers className="h-5 w-5 text-[var(--text-faint)]" />
              <p className="max-w-sm text-xs leading-relaxed text-[var(--text-faint)]">
                {t("common.no-profiles-yet-set-up-a-look-you-like-then-cap")}
              </p>
              <Btn size="sm" variant="primary" onClick={picker.openSave}>
                {t("common.capture-current-look")}
              </Btn>
            </div>
          ) : (
            <>
              <ul className="-m-1 space-y-0.5">
                {profileList.shown.map((s) => {
                  const isActive = s.id === picker.activeId;
                  const isApplying = picker.applyingId === s.id;
                  const sum = profileSummary(s);
                  return (
                    <li key={s.id}>
                      {



 }
                      <button
                        onClick={() => picker.apply(s.id)}
                        disabled={isActive || isApplying}
                        aria-busy={isApplying || undefined}
                        aria-current={isActive || undefined}
                        className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-default ${
                          isActive
                            ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.1)]"
                            : "border-transparent hover:border-[var(--line)] hover:bg-[var(--panel-strong)]"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[var(--text)]">
                            {s.name}
                          </span>
                          {

 }
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--text-faint)]">
                            {sum.stickers > 0
                              ? `${sum.kind} · ${sum.mode} · ${t("common.{n}-stickers", {
                                  n: sum.stickers,
                                })}`
                              : `${sum.kind} · ${sum.mode}`}
                          </span>
                        </span>
                        {isApplying ? (
                          <IconSpinner className="h-4 w-4 shrink-0 animate-spin text-[rgb(var(--glow))]" />
                        ) : isActive ? (
                          <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[rgb(var(--glow))]">
                            <IconCheck className="h-3.5 w-3.5" />
                            {t("common.profile-applied-now")}
                          </span>
                        ) : (
                          <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] opacity-40 transition-opacity group-hover:opacity-100" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {profileList.hidden > 0 && (
                <button
                  onClick={() => onNavigate("general")}
                  className="mt-2.5 px-1 text-xs font-semibold text-[var(--text-faint)] transition-colors hover:text-[rgb(var(--glow))]"
                >
                  {t("common.{n}-more-profiles", { n: profileList.hidden })}
                </button>
              )}
            </>
          )}
        </Card>

        <ShortcutsCard
          hotkeys={cfg.general.hotkeys}
          hotkeysEnabled={cfg.general.hotkeysEnabled ?? true}
        />
      </div>

      { }
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            {
              id: "rgb",
              label: t("common.lighting"),
              detail: rgb.connected
                ? t("common.{mode}-{leds}-leds", {
                    mode: cfg.rgb.mode,
                    leds: ledActive.toLocaleString(),
                  })
                : t("common.connect-openrgb"),
              Icon: IconBulb,
            },
            {
              id: "wallpaper",
              label: t("common.wallpaper"),
              detail: t("common.{n}-in-vault-{name}", {
                n: cfg.gallery.length,
                name: playlistOn ? t("common.rotating") : wallpaperName,
              }),
              Icon: IconImage,
            },
            {
              id: "stickers",
              label: t("common.stickers"),
              detail: stickers.length
                ? t("common.{visible}-{total}-visible", {
                    visible: visibleStickers.length,
                    total: stickers.length,
                  })
                : t("common.none-placed-yet"),
              Icon: IconSticker,
            },
            {
              id: "general",
              label: t("nav.settings"),
              detail: t("common.profiles-and-shortcuts"),
              Icon: IconLayers,
            },
          ] as const
        ).map(({ id, label, detail, Icon }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="glass group flex items-center gap-3.5 p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] active:scale-[0.99]"
          >
            <IconBox variant="neutral" size="md">
              <Icon className="h-5 w-5 text-[rgb(var(--glow))]" />
            </IconBox>
            <span className="min-w-0 flex-1">
              <ItemTitle as="span">{label}</ItemTitle>
              <span className="block truncate text-dim-sm">{detail}</span>
            </span>
            <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-all group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
          </button>
        ))}
      </div>

      {

 }
      {picker.open && (
        <ConfigPickerModal
          scenes={picker.scenes}
          activeId={picker.activeId}
          applyingId={picker.applyingId}
          startIn={picker.startInSave ? "save" : "browse"}
          onClose={picker.close}
          onApply={picker.apply}
          onSave={picker.save}
          onRename={picker.rename}
          onDelete={picker.remove}
          onChooseLogo={picker.chooseLogo}
          onClearLogo={(id) => picker.setLogo(id, null)}
          canDelete={picker.canDelete}
        />
      )}
    </div>
  );
}
