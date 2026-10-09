import { useShallow } from "zustand/react/shallow";
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { useStore } from "../../store";
import { Card, Chip, ChipButton, DisplaysCard, GHOST_LINK, GHOST_LINK_CHEVRON, RefreshBtn, type ChipTone } from "../ui";
import { ConfigPickerModal } from "../ConfigPickerModal";
import { useConfigPicker } from "../useConfigPicker";
import { attentionItems } from "../overviewCards";
import SystemCard from "../SystemCard";
import { ledCounts } from "../deviceList";
import { IconBulb, IconImage, IconSticker, IconLayers, IconMonitor, IconChevronRight } from "../icons";
import { SHADERS, ANIMATION_MODES, RGB_MODES } from "@shared/constants";
import { basename } from "../../utilities";
import { api } from "../../ipc";
import { usePending } from "../../pending";
import { t } from "../../i18n";
import MediaCardBody from "../overview/MediaCard";
import EngineCard from "../overview/EngineCard";
import {
  useGreetingKey,
  useAudioVars,
} from "../overview/hooks";

const GREETING_KEYS = {
  "overview.up-late": "overview.up-late-{name}",
  "overview.good-morning": "overview.good-morning-{name}",
  "overview.good-afternoon": "overview.good-afternoon-{name}",
  "overview.good-evening": "overview.good-evening-{name}",
} as const;

function StatusTile({
  icon,
  title,
  detail,
  state,
  tone,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  state: string;
  tone: ChipTone;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${title}: ${detail}. ${state}`}
      className="group flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-3 text-left shadow-[var(--shadow)] transition-[border-color,background-color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:border-[rgb(var(--glow)/0.4)] hover:bg-[var(--panel-strong)]"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[rgb(var(--glow)/0.18)] bg-[rgb(var(--glow)/0.08)] text-[rgb(var(--glow))] [&_svg]:h-4 [&_svg]:w-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="kicker block truncate">{title}</span>
        <span className="mt-0.5 block truncate text-[13px] font-semibold text-[var(--text)]" title={detail}>
          {detail}
        </span>
        <span className="mt-1.5 block">
          <Chip tone={tone}>{state}</Chip>
        </span>
      </span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-[var(--text-faint)] transition-transform duration-[var(--motion-fast)] ease-[var(--ease-standard)] group-hover:translate-x-0.5 group-hover:text-[rgb(var(--glow))]" />
    </button>
  );
}

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
  const [displayCount, setDisplayCount] = useState<number | null>(null);
  const [displayCheckFailed, setDisplayCheckFailed] = useState(false);
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
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const loadDisplays = () => {
      void api
        .monitors()
        .then((monitors) => {
          if (!disposed) {
            setDisplayCount(monitors.length);
            setDisplayCheckFailed(false);
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setDisplayCheckFailed(true);
            console.warn("[overview] display summary unavailable", error);
          }
        });
    };
    loadDisplays();
    void listen("display-changed", loadDisplays)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((error: unknown) => {
        if (!disposed) {
          console.warn("[overview] display change listener unavailable", error);
        }
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  const { pending, run } = usePending();
  const audio = useAudioVars(!!media?.playing);

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  const counts = ledCounts(rgb.devices, cfg.rgb.excludedDevices);
  const isAnimatedMode = (ANIMATION_MODES as ReadonlySet<string>).has(cfg.rgb.mode);
  const activeMode = RGB_MODES.find((mode) => mode.id === cfg.rgb.mode);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const picker = useConfigPicker();
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
  const wallpaperTone = !cfg.general.wallpaperEnabled
    ? "idle"
    : wallpaperPaused
      ? "warn"
      : "ok";
  const wallpaperState = !cfg.general.wallpaperEnabled
    ? t("common.off")
    : wallpaperPaused
      ? t("overview.wallpaper-paused")
      : t("overview.live");
  const lightingTone = !rgb.connected
    ? "danger"
    : cfg.rgb.enabled
      ? "ok"
      : "idle";
  const lightingState = !rgb.connected
    ? t("overview.openrgb-offline")
    : cfg.rgb.enabled
      ? t("overview.live")
      : t("common.off");
  const displayLabel =
    displayCheckFailed
      ? t("overview.display-check-failed")
      : displayCount === null
      ? t("overview.checking-displays")
      : displayCount === 1
        ? t("overview.one-display")
        : t("overview.display-count", { n: displayCount });

  return (
    <div className="@container stagger space-y-4 sm:space-y-5">

      <header className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <h1 className="max-w-full break-words text-[clamp(1.75rem,3.4vw,2.5rem)] font-semibold leading-[1.05] tracking-[-0.045em] text-[var(--text)]">
              {greeting}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshBtn />
          </div>
        </div>

        <div className="mt-2.5 flex min-h-6 flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--text-faint)]">
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
        </div>
      </header>

      <div className="grid gap-2.5 @[38rem]:grid-cols-2 @[64rem]:grid-cols-4">
        <StatusTile
          icon={<IconImage />}
          title={t("common.wallpaper")}
          detail={wallpaperName}
          state={wallpaperState}
          tone={wallpaperTone}
          onClick={() => onNavigate("wallpaper")}
        />
        <StatusTile
          icon={<IconBulb />}
          title={t("common.lighting")}
          detail={activeMode ? t(activeMode.label) : cfg.rgb.mode}
          state={lightingState}
          tone={lightingTone}
          onClick={() => onNavigate("rgb")}
        />
        <StatusTile
          icon={<IconMonitor />}
          title={t("common.displays")}
          detail={displayLabel}
          state={t("overview.manage-displays")}
          tone={displayCheckFailed ? "warn" : displayCount === 0 ? "danger" : "idle"}
          onClick={() => onNavigate("general")}
        />
        <StatusTile
          icon={<IconLayers />}
          title={t("common.profiles")}
          detail={picker.activeName ?? t("overview.no-profile-applied")}
          state={t("overview.change-profile")}
          tone={picker.activeName ? "accent" : "idle"}
          onClick={picker.openBrowse}
        />
      </div>

      <div
        ref={audio.ref}
        style={audio.style}
        className="grid min-w-0 items-start gap-4 @[38rem]:grid-cols-12 @[56rem]:gap-5"
      >

        <Card
          title={t("overview.desktop-preview")}
          icon={<IconImage />}
          className="@[38rem]:col-span-7"
          noShadow
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


        <EngineCard
          cfg={cfg}
          rgb={rgb}
          counts={counts}
          save={save}
          nightOn={nightOn}
          idleOn={idleOn}
          isAnimatedMode={isAnimatedMode}
          onOpenLighting={() => onNavigate("rgb")}
        />
      </div>



      <div className="grid min-w-0 items-start gap-4 @[38rem]:grid-cols-12 @[56rem]:gap-5">
        <div className="@[38rem]:col-span-7">
          <DisplaysCard compact onManage={() => onNavigate("general")} />
        </div>
        <div className="@[38rem]:col-span-5">
          <Card
            title={t("overview.stickers-and-desktop-widgets")}
            icon={<IconSticker />}
            right={
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  {t("common.{visible}-{total}-visible", {
                    visible: visibleStickers.length,
                    total: stickers.length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate("stickers")}
                  aria-label={t("common.manage")}
                  data-tip={t("common.manage")}
                  className={`group ${GHOST_LINK}`}
                >
                  <IconChevronRight className={GHOST_LINK_CHEVRON} />
                </button>
              </div>
            }
          >
            {stickers.length === 0 ? (
              <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed border-[var(--line-strong)] p-3.5">
                <div className="flex items-center gap-2 text-[var(--text-dim)]">
                  <IconSticker className="h-4 w-4 text-[rgb(var(--glow))]" />
                  <span className="text-xs font-semibold">{t("common.no-stickers-yet")}</span>
                </div>
                <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
                  {t("common.add-an-image-gif-or-short-video-and-click-once-o")}
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate("stickers")}
                  className="text-xs font-semibold text-[rgb(var(--glow))] transition-colors hover:text-[var(--text)]"
                >
                  {t("common.add-your-first-sticker")}
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {stickers.slice(0, 3).map((s) => (
                  <button
                    key={s.id}
                    title={t(s.visible ? "overview.hide-this-sticker" : "overview.show-this-sticker")}
                    onClick={() => {
                      void run(`sticker-${s.id}`, () =>
                        api.updateSticker({ ...s, visible: !s.visible }),
                      );
                    }}
                    aria-label={`${s.name}: ${t(s.visible ? "overview.hide-this-sticker" : "overview.show-this-sticker")}`}
                    aria-pressed={s.visible}
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
              </div>
            )}
          </Card>
        </div>
      </div>


      <SystemCard />

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
