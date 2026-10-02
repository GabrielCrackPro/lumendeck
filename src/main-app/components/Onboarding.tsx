// First-run onboarding: five steps, done in under a minute.
//  1. Wallpaper — pick from the vault (or keep the default)
//  2. Import — pull media into the vault (file / folder / URL)
//  3. Lighting — detect OpenRGB, or skip (wallpaper-only is a valid setup)
//  4. Mood — a starting lighting mode + accent behavior
//  5. Configs — the toggles most people change (power, startup, visuals)
// Skippable at any point; the app is fully usable without finishing.
import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { api } from "../ipc";
import { Btn, Toggle, ThemePicker, ItemTitle } from "./ui";
import { RGB_MODES } from "@shared/constants";
import { basename, truncateError } from "../utilities";
import { resolvePicked } from "./gallery/mediaKind";
import type { RgbMode } from "@shared/types";
import { t } from "../i18n";

const STEPS = ["Wallpaper", "Import", "Lighting", "Mood", "Config"] as const;

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { cfg, save, rgb } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save, rgb: s.rgb })),
  );
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [urlMode, setUrlMode] = useState(false);
  const [url, setUrl] = useState("");
  const [imported, setImported] = useState(0);
  const toast = (tone: "error" | "ok", msg: string) =>
    useStore.getState().toast(tone, msg);

  if (!cfg) return null;

  const finish = () => {
    setBusy(true);
    save((c) => {
      c.general.onboarded = true;
    }).finally(() => {
      setBusy(false);
      onDone();
    });
  };

  const applyVaultFirst = async () => {
    setBusy(true);
    try {
      const first = cfg.gallery[0];
      if (first) await api.galleryApply(first.id);
      setStep(1);
    } finally {
      setBusy(false);
    }
  };

  const importFile = async () => {
    setBusy(true);
    try {
      const files = await api.pickMediaFiles();
      const first = resolvePicked(files)[0];
      if (!first) return;
      await api.galleryAdd({
        name: basename(first.path),
        kind: first.kind,
        source: first.path,
      });
      setImported((n) => n + 1);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      toast("ok", t("common.added-to-vault"));
    } catch (e) {
      toast("error", t("onboarding.import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const [folderChoices, setFolderChoices] = useState<
    { id: string; name: string }[]
  >([]);

  const importFolder = async () => {
    setBusy(true);
    try {
      const folder = await api.pickMediaFolder();
      if (!folder) return;
      const list = await api.galleryImportFolder(folder);
      setImported((n) => n + list.length);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      // Offer the imported items so the user can land one immediately.
      setFolderChoices(
        fresh.gallery
          .filter((g) => list.some((x) => x.id === g.id))
          .map((g) => ({ id: g.id, name: g.name })),
      );
      toast("ok", t("onboarding.imported-{n}-items", { n: list.length }));
    } catch (e) {
      toast("error", t("onboarding.folder-import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const applyChoice = async (id: string) => {
    setBusy(true);
    try {
      await api.galleryApply(id);
      toast("ok", t("common.wallpaper-applied"));
      setFolderChoices([]);
    } catch (e) {
      toast("error", t("onboarding.apply-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  const importUrl = async () => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      const list = await api.galleryAddFromUrl(url.trim());
      setImported((n) => n + 1);
      setUrl("");
      setUrlMode(false);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      const added = list[list.length - 1];
      toast("ok", t("onboarding.downloaded-{name}", { name: added?.name ?? "wallpaper" }));
    } catch (e) {
      toast("error", t("onboarding.url-import-failed-{error}", { error: truncateError(e) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grain relative flex h-screen items-center justify-center overflow-hidden">
      <div className="aura" />
      <div className="relative z-10 w-full max-w-xl px-6">
        {/* progress dots */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`flex h-6 w-6 items-center justify-center rounded-full border font-mono text-[10px] transition-all ${
                  i === step
                    ? "border-[rgb(var(--glow))] bg-[rgb(var(--glow)/0.15)] text-[rgb(var(--glow))]"
                    : i < step
                      ? "border-transparent bg-[rgb(var(--glow))] text-black"
                      : "border-[var(--line-strong)] text-[var(--text-faint)]"
                }`}
              >
                {i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  className={`h-px w-10 transition-colors ${
                    i < step ? "bg-[rgb(var(--glow))]" : "bg-[var(--line-strong)]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <section className="glass p-7">
          {step === 0 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">{t("onboarding.welcome-to-lumendeck")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.live-wallpapers-that-light-up-your-room-and-your")}
              </p>
              <div className="mt-5 space-y-2.5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                  <ItemTitle>
                    {cfg.gallery.length > 0
                      ? t("onboarding.{n}-wallpapers-in-your-vault", { n: cfg.gallery.length })
                      : t("onboarding.your-vault-is-empty")}
                  </ItemTitle>
                  <div className="mt-1 text-xs text-[var(--text-faint)]">
                    {cfg.gallery.length > 0
                      ? t("onboarding.we'll-apply-your-first-one-now-browse-the-vault")
                      : t("onboarding.import-from-the-wallpaper-tab-after-setup-or-kee")}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={finish} disabled={busy}>
                  {t("onboarding.skip-setup")}
                </Btn>
                <Btn variant="primary" onClick={applyVaultFirst} disabled={busy}>
                  {cfg.gallery.length > 0
                    ? t("onboarding.use-my-first-wallpaper")
                    : t("onboarding.continue")}
                </Btn>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">{t("onboarding.bring-in-your-media")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.fill-the-vault-with-videos-images-or-folders-you")}
              </p>
              <div className="mt-5 space-y-2.5">
                {imported > 0 && (
                  <div className="rounded-xl border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-4 py-3 text-sm font-medium text-[rgb(var(--glow))]">
                    {t("onboarding.{n}-items-added-to-your-vault", { n: imported })}
                  </div>
                )}
                {folderChoices.length > 0 && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                    <div className="kicker mb-2">
                      {t("onboarding.set-one-as-your-wallpaper-now")}
                    </div>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                      {folderChoices.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => applyChoice(c.id)}
                          disabled={busy}
                          className="flex w-full items-center justify-between rounded-lg border border-[var(--line)] px-3 py-2 text-left text-sm text-[var(--text-dim)] hover-glow disabled:opacity-50"
                        >
                          <span className="min-w-0 truncate">{c.name}</span>
                          <span className="ml-2 shrink-0 font-mono text-[10px] uppercase tracking-widest">
                            {t("onboarding.apply")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {urlMode ? (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        type="url"
                        placeholder="https://example.com/wallpaper.mp4"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && importUrl()}
                        className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--panel-sunken)] px-3 py-2 text-sm outline-none focus:border-[rgb(var(--glow)/0.5)]"
                      />
                      <Btn variant="primary" size="sm" disabled={busy || !url.trim()} onClick={importUrl}>
                        {t("onboarding.download")}
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setUrlMode(false)}>
                        {t("onboarding.cancel")}
                      </Btn>
                    </div>
                    <p className="mt-2 text-dim-sm">
                      {t("onboarding.direct-link-to-an-mp4-webm-video-or-png-jpg-webp")}
                    </p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={importFile}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
                    >
                      <span>
                        <ItemTitle as="span">{t("onboarding.import-a-file")}</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">{t("onboarding.a-video-or-image-from-your-pc")}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">{t("onboarding.pick")}</span>
                    </button>
                    <button
                      onClick={importFolder}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
                    >
                      <span>
                        <ItemTitle as="span">{t("onboarding.import-a-folder")}</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">{t("onboarding.every-video-and-image-inside-in-one-go")}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">{t("onboarding.pick")}</span>
                    </button>
                    <button
                      onClick={() => setUrlMode(true)}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
                    >
                      <span>
                        <ItemTitle as="span">{t("onboarding.from-a-url")}</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">{t("onboarding.download-a-wallpaper-from-a-direct-link")}</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">{t("onboarding.link")}</span>
                    </button>
                  </>
                )}
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(0)}>
                  {t("onboarding.back")}
                </Btn>
                <Btn variant="primary" onClick={() => setStep(2)} disabled={busy}>
                  {imported > 0 ? t("onboarding.continue") : t("onboarding.skip-later")}
                </Btn>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">{t("onboarding.sync-your-rgb-lighting")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                {t("onboarding.connect-to-openrgb-to-have-your-devices-follow-t")}
              </p>
              <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <ItemTitle>
                      {rgb.connected ? t("onboarding.{n}-devices-detected", { n: rgb.devices.length }) : t("onboarding.openrgb-not-detected")}
                    </ItemTitle>
                    <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                      {rgb.connected
                        ? t("onboarding.you're-set-devices-will-follow-the-modes-on-the")
                        : t("onboarding.start-openrgb-with-the-server-enabled-then-retry")}
                    </div>
                  </div>
                  {!rgb.connected && (
                    <Btn
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api.rgbRefresh();
                          const fresh = await api.getConfig();
                          useStore.setState({ cfg: fresh });
                          const st = await api.rgbStatus();
                          useStore.getState().setRgb(st);
                        } catch {
                          // status stays offline; copy above reflects it
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      {t("onboarding.retry")}
                    </Btn>
                  )}
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(1)}>
                  {t("onboarding.back")}
                </Btn>
                <Btn variant="primary" onClick={() => setStep(3)} disabled={busy}>
                  {t("onboarding.continue")}
                </Btn>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">{t("onboarding.your-lighting-mood")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">                {t("onboarding.pick-how-your-devices-behave-ambient-follows-the")}
              </p>
              <div className="mt-5 grid grid-cols-2 gap-2.5">
                {RGB_MODES.filter((m) => m.group === "reactive" || m.id === "breathe").map(
                  (m) => {
                    const active = cfg.rgb.mode === m.id;
                    return (
                      <button
                        key={m.id}
                        onClick={() => save((c) => (c.rgb.mode = m.id as RgbMode))}
                        className={`rounded-xl border p-3.5 text-left transition-all active:scale-[0.98] ${
                          active
                            ? "border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] ring-1 ring-[rgb(var(--glow)/0.3)]"
                            : "border-[var(--line)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <ItemTitle>{t(m.label)}</ItemTitle>
                        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                          {t(m.hint)}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(2)}>
                  {t("onboarding.back")}
                </Btn>
                <Btn variant="primary" onClick={() => setStep(4)} disabled={busy}>
                  {t("onboarding.continue")}
                </Btn>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">{t("onboarding.common-settings")}</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">                {t("onboarding.the-toggles-most-people-change-you-can-fine-tune")}
              </p>
              <div className="mt-4 space-y-0.5">
                {/* The same picker as Settings, so the choice made here looks
                    exactly like the one they will find later. */}
                <ThemePicker
                  value={cfg.general.theme}
                  onChange={(v) => save((c) => (c.general.theme = v))}
                />
                <Toggle
                  label={t("onboarding.amoled-mode")}
                  description={t("onboarding.true-black-dashboard-in-dark-theme-ideal-for-ole")}
                  checked={cfg.general.amoled ?? false}
                  onChange={(v) => save((c) => (c.general.amoled = v))}
                />
                <div className="border-t border-[var(--line)]" />
                <Toggle
                  label={t("onboarding.launch-at-startup")}
                  description={t("onboarding.start-lumendeck-with-windows")}
                  checked={cfg.general.autostart}
                  onChange={(v) => save((c) => (c.general.autostart = v))}
                />
                <Toggle
                  label={t("onboarding.pause-on-fullscreen-apps")}
                  description={t("onboarding.pause-on-fullscreen-description")}
                  checked={cfg.general.pauseOnFullscreen}
                  onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
                />
                <Toggle
                  label={t("onboarding.pause-on-battery")}
                  description={t("onboarding.freeze-the-wallpaper-while-unplugged-recommended")}
                  checked={cfg.general.pauseOnBatterySaver}
                  onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
                />
                <Toggle
                  label={t("onboarding.windows-accent-follows-wallpaper")}
                  description={t("onboarding.taskbar-and-window-highlights-shift-tone-with-yo")}
                  checked={cfg.general.accentSyncEnabled}
                  onChange={(v) => save((c) => (c.general.accentSyncEnabled = v))}
                />
                <Toggle
                  label={t("onboarding.stickers-on-all-monitors")}
                  description={t("onboarding.mirror-wallpaper-stickers-onto-every-display")}
                  checked={cfg.sticker?.allMonitors ?? true}
                  onChange={(v) => save((c) => (c.sticker = { ...c.sticker, allMonitors: v }))}
                />
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(3)}>
                  {t("onboarding.back")}
                </Btn>
                <Btn variant="primary" onClick={finish} disabled={busy}>
                  {busy ? t("onboarding.saving") : t("onboarding.finish-setup")}
                </Btn>
              </div>
            </>
          )}
        </section>

        <div className="mt-4 text-center">
          <button
            onClick={finish}
            className="font-mono text-[10px] tracking-widest text-[var(--text-faint)] uppercase transition-colors hover:text-[var(--text-dim)]"
          >
            {t("onboarding.skip-set-up-later-in-settings")}
          </button>
        </div>
      </div>
    </div>
  );
}
