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

/**
 * The four salutations, each mapped to the same sentence with the account name
 * folded in.
 *
 * Written as a map rather than interpolated at the call site so that both forms
 * of every salutation sit together and are visible to `i18n-check` — a
 * template-literal key would leave the named half looking dead. The pairing is
 * the point: nothing here can end up greeting someone by name with the
 * afternoon's sentence.
 */
const GREETING_KEYS = {
  "overview.up-late": "overview.up-late-{name}",
  "overview.good-morning": "overview.good-morning-{name}",
  "overview.good-afternoon": "overview.good-afternoon-{name}",
  "overview.good-evening": "overview.good-evening-{name}",
} as const;

export default function OverviewTab({ onNavigate }: { onNavigate: (t: string) => void }) {
  // Every field here changes at human speed. The one thing on this screen that
  // does not is the live device colour — republished ~12x/second — and it is
  // deliberately absent: selecting it put the entire tab on that cadence,
  // repainting the media card, the profile list and the shortcuts twelve times a
  // second to move one colour bar. Each DeviceRow reads its own slice instead.
  const { cfg, rgb, wallpaperPaused, save, media } = useStore(
    useShallow((s) => ({
      cfg: s.cfg,
      rgb: s.rgb,
      wallpaperPaused: s.wallpaperPaused,
      save: s.save,
      media: s.media,
    })),
  );
  // Any config save holds the store's one `saving` flag; the attention chips
  // that answer by saving read it so a second press while the first write is
  // in flight cannot double-apply the same fix. Navigation needs no guard —
  // it is a client-side state change, not a write.
  const saving = useStore((s) => s.saving);
  // The signed-in Windows account, for the greeting below. Asked once: it
  // cannot change while the app runs. An empty string is a real answer, not a
  // placeholder — Windows sometimes will not say — and it has to fall back to
  // the unnamed salutation rather than print a comma with nothing after it.
  const [accountName, setAccountName] = useState("");
  // Whether the engine card is showing every device. Lived in the card until
  // this: it is a property of how much room the user wants this card to take on
  // the page, not of any one row, and it has to survive the row list changing
  // underneath it when a device connects.
  const [allDevices, setAllDevices] = useState(false);
  useEffect(() => {
    let disposed = false;
    void api
      .accountName()
      .then((name) => {
        if (!disposed) setAccountName(name);
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);
  // The list rows below each drive one IPC call, keyed by entity so two rows
  // can be in flight without blocking one another.
  const { pending, run } = usePending();
  const fps = useFps();
  // Accent provenance: the same resolver that paints `--glow` names its own
  // branch, so the chip below cannot claim a source the interface is not
  // using. A clock for it is unnecessary — the resolver is reactive, so the
  // chip re-derives whenever any of its three switches or its sources move.
  const accentFrom = useAccent().source;
  // Written onto the row holding both cards, because both read the variables.
  const audio = useAudioVars(!!media?.playing);

  if (!cfg) return null;

  const stickers = cfg.stickers;
  const visibleStickers = stickers.filter((s) => s.visible);
  // One walk derives every figure this tab prints, instead of the private
  // reduce pair this used to keep — which could drift from the lighting tab's
  // copy of the same arithmetic.
  const counts = ledCounts(rgb.devices, cfg.rgb.excludedDevices);
  const ledActive = counts.active;
  const excluded = new Set(cfg.rgb.excludedDevices);
  const isAnimatedMode = (ANIMATION_MODES as ReadonlySet<string>).has(cfg.rgb.mode);
  const paused = !cfg.general.wallpaperEnabled || wallpaperPaused;
  const idleOn = cfg.rgb.idleTimeoutSec > 0;
  const nightOn = !!cfg.rgb.nightStart && !!cfg.rgb.nightEnd;
  const playlistOn = (cfg.playlists ?? []).some((p) => p.enabled);
  // The picker, not a second hand-rolled list: this card must agree with the
  // header avatar about which profile is applied, and `useConfigPicker` is the
  // one derivation of that. Applying from here goes through its `apply`, so
  // the in-flight row and the failure toast behave as they do in Settings --
  // and on success the row itself turns into the "Applied now" tick, which is
  // why the old "profile applied" toast is no longer needed.
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
  // Truncation that keeps the applied profile in view; see `visibleProfiles`.
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

  // Re-derived on an interval, not read at render: the tab no longer
  // re-renders on the old 12Hz frame loop, so a greeting read once would say
  // "Good morning" until something else happened to re-render the tab. The
  // interval fires at the next hour boundary — waking up exactly when the
  // answer changes — rather than polling every minute.
  const greetingKey = useGreetingKey();
  const greeting = accountName
    ? t(GREETING_KEYS[greetingKey], { name: accountName })
    : t(greetingKey);
  // Every thing that wants doing, each with the click that fixes it. This used
  // to be a chain of `if`s whose last arm only ran when nothing else had, so a
  // machine with two problems was told about one of them.
  const attention = attentionItems({
    rgbConnected: rgb.connected,
    wallpaperPaused: paused,
    lightingEnabled: cfg.rgb.enabled,
  });

  return (
    <div className="stagger space-y-5">
      {/* ===== header: salutation, live state, and the counted strip ===== */}
      <header className="min-w-0">
        {/* Kicker row: which tab this is, and the version of the engine
            running it. The version is here rather than only in the title bar
            because this is the screen that reports on the engine. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="kicker">{t("overview.at-a-glance")}</span>
          <span aria-hidden className="text-[var(--text-faint)]">·</span>
          {/* A chip rather than loose text: this is the engine's version, and
              the card header below is the engine. Matching them lets the eye
              connect "what version" with "what is running". */}
          <span className="rounded-md border border-[rgb(var(--glow)/0.35)] bg-[rgb(var(--glow)/0.08)] px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.14em] text-[rgb(var(--glow))]">
            {t("overview.engine", { v: versionLabel(__APP_VERSION__) })}
          </span>
        </div>

        {/* Salutation and the right-hand controls share a baseline, which is
            what makes the row read as one header rather than a heading with
            something parked beside it. */}
        <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="lednum text-[34px] leading-none text-[var(--text)]">
              {greeting}
            </h1>
            {/* The config avatar lives in the app header now, not here: it is a
                property of the machine rather than of this screen, and it used
                to vanish the moment you opened another tab. */}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <RefreshBtn />
          </div>
        </div>

        {/* The status strip. Two jobs, and both are things no card below can
            do: say what wants fixing and where the accent came from. The counts
            that used to be here — devices, LEDs, stickers — are gone because the
            cards below already print each of them, and printing the same number
            four times on one screen is how two of them drift. */}
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

          {/* Where the accent is coming from. Three switches in two other tabs
              decide this, and until now the tab that shows the result named
              none of them — which is exactly why "why is it blue" needed a log. */}
          <Chip tone="idle">
            {t(ACCENT_SOURCE_LABELS[accentFrom])}
          </Chip>

          {lastChange && (
            <span className="text-[var(--text-dim)]">
              {t(lastChange.labelKey, { recency: recencyText(lastChange.at, now) })}
            </span>
          )}

          {/* 0 is "still warming up", not "the app is not running": the frame
              loop has nothing to average for its first second, and printing
              0 FPS there would be a stall report about nothing. */}
          <span className="tabular-nums text-[var(--text-faint)]">
            {fps > 0 ? t("common.{n}-fps", { n: fps }) : t("common.fps-warming-up")}
          </span>
        </div>
      </header>
      {/* ===== row 1: now playing + engine ===== */}
      <div
        ref={audio.ref}
        style={audio.style}
        // `items-start`, and it is the whole fix for a card that changes height.
        //
        // A grid row is as tall as its tallest item and every other item is
        // stretched to fill it, so opening a device row grew the engine card and
        // dragged the Now playing card beside it to the same height — 73px of
        // wallpaper and transport stretched across 478px of empty panel,
        // measured. The stretch is invisible while the row's contents happen to
        // be the same height, which is why it only ever showed up as "expanding
        // moves the other thing".
        //
        // `start` and not `self-start` on the card: the cards are direct grid
        // items, and setting it here means a future card in this row inherits
        // the same independence rather than having to remember.
        className="grid min-w-0 items-start gap-5 xl:grid-cols-12"
      >
        {/* Now playing — spans 5. The wallpaper is the card: its own strip
            docked at the top edge, the player docked at the bottom. */}
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

        {/* Engine — spans 7. The device list is the hero: it carries the live
            LEDs, the device identity and the mute control in one place, so no
            other part of the card has to repeat the same counts. */}
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

      {/* ===== row 2: displays + stickers ===== */}
      {/* `items-start` for the same reason as the engine row above: these cards
          have independent content, and a grid row otherwise makes the shorter
          one grow to match the taller one. */}
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

      {/* ===== row 3: system =====
          Its own full-width row rather than a column beside another card. Both
          curves are unreadable at a third of the width -- the shape is the
          whole point of the card, and a squashed sparkline shows only that
          there was some activity, which the header's frame rate already said. */}
      <SystemCard />

      {/* ===== row 4: profiles + shortcuts =====
          Not gated on there being any profiles: the shortcuts half describes
          the keyboard, which exists whether or not anything has been captured
          yet, and the old `scenes.length > 0` took both cards away together. */}
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
            /* An empty state rather than a missing card. A card that only
               exists once you have used it teaches nothing about the feature,
               and this is the screen a new user lands on. */
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
                      {/* The whole row is the target, because applying a profile
                          is the only thing a row does here and a card-sized
                          target with no other controls inside it cannot
                          misfire. Management lives in the picker, which is one
                          click away and has room for it. */}
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
                          {/* What the profile holds. A bare list of names
                              cannot tell "Work" from "Work, dimmed", and this
                              is the row that decides which gets applied. */}
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
                          /* Quiet rather than hidden until hover: this row is
                             clickable, and a chevron that only appears under the
                             mouse says nothing to anyone using the keyboard. */
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

      {/* jump links */}
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
              // Settings is the fourth tile because every destination the
              // header strip can raise an issue about is fixed from there --
              // OpenRGB offline, wallpaper paused, lighting switched off. A
              // tile that navigates nowhere real would be worse than three.
              id: "general",
              // `nav.settings`, not a new `common.` key: the rail, the command
              // palette and this tile must all call the tab the same thing, and
              // the nav key is the one they already share.
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

      {/* The empty-state "Capture current look" opens this, and applying a
          profile from the card goes through the same hook, so the modal has
          to live here rather than only in Settings. */}
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
