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
import { Btn, Toggle, Select, ItemTitle } from "./ui";
import { RGB_MODES } from "@shared/constants";
import { basename, truncateError } from "../utilities";
import type { RgbMode, ThemeMode } from "@shared/types";

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
      const file = await api.pickMediaFile();
      if (!file) return;
      await api.galleryAdd({
        name: basename(file),
        kind: /\.(mp4|webm|mov|m4v|mkv)$/i.test(file) ? "video" : "image",
        source: file,
      });
      setImported((n) => n + 1);
      const fresh = await api.getConfig();
      useStore.setState({ cfg: fresh });
      toast("ok", "Added to vault");
    } catch (e) {
      toast("error", `Import failed: ${truncateError(e)}`);
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
      toast("ok", `Imported ${list.length} item${list.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast("error", `Folder import failed: ${truncateError(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const applyChoice = async (id: string) => {
    setBusy(true);
    try {
      await api.galleryApply(id);
      toast("ok", "Wallpaper applied");
      setFolderChoices([]);
    } catch (e) {
      toast("error", `Apply failed: ${truncateError(e)}`);
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
      toast("ok", `Downloaded "${added?.name ?? "wallpaper"}"`);
    } catch (e) {
      toast("error", `URL import failed: ${truncateError(e)}`);
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
              <h1 className="lednum text-lg text-[var(--text)]">Welcome to LumenDeck</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                Live wallpapers that light up your room and your OS. Let&apos;s set the
                basics — you can change everything later.
              </p>
              <div className="mt-5 space-y-2.5">
                <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                  <ItemTitle>
                    {cfg.gallery.length > 0
                      ? `${cfg.gallery.length} wallpapers in your vault`
                      : "Your vault is empty"}
                  </ItemTitle>
                  <div className="mt-1 text-xs text-[var(--text-faint)]">
                    {cfg.gallery.length > 0
                      ? "We'll apply your first one now — browse the vault after setup."
                      : "Import from the Wallpaper tab after setup, or keep the current look."}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={finish} disabled={busy}>
                  Skip setup
                </Btn>
                <Btn variant="primary" onClick={applyVaultFirst} disabled={busy}>
                  {cfg.gallery.length > 0 ? "Use my first wallpaper" : "Continue"}
                </Btn>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">Bring in your media</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                Fill the vault with videos, images or folders. You can always add
                more later from the Wallpaper tab.
              </p>
              <div className="mt-5 space-y-2.5">
                {imported > 0 && (
                  <div className="rounded-xl border border-[rgb(var(--glow)/0.4)] bg-[rgb(var(--glow)/0.08)] px-4 py-3 text-sm font-medium text-[rgb(var(--glow))]">
                    {imported} item{imported === 1 ? "" : "s"} added to your vault
                  </div>
                )}
                {folderChoices.length > 0 && (
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                    <div className="kicker mb-2">Set one as your wallpaper now?</div>
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
                            apply
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
                        Download
                      </Btn>
                      <Btn variant="ghost" size="sm" onClick={() => setUrlMode(false)}>
                        Cancel
                      </Btn>
                    </div>
                    <p className="mt-2 text-dim-sm">
                      Direct link to an mp4/webm video or png/jpg/webp/gif image (max 200 MB).
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
                        <ItemTitle as="span">Import a file</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">A video or image from your PC</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">pick</span>
                    </button>
                    <button
                      onClick={importFolder}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
                    >
                      <span>
                        <ItemTitle as="span">Import a folder</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">Every video and image inside, in one go</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">pick</span>
                    </button>
                    <button
                      onClick={() => setUrlMode(true)}
                      disabled={busy}
                      className="flex w-full items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4 text-left transition-all hover:border-[rgb(var(--glow)/0.5)] disabled:opacity-50"
                    >
                      <span>
                        <ItemTitle as="span">From a URL</ItemTitle>
                        <span className="mt-0.5 block text-xs text-[var(--text-faint)]">Download a wallpaper from a direct link</span>
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-widest text-[rgb(var(--glow))]">link</span>
                    </button>
                  </>
                )}
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Btn>
                <Btn variant="primary" onClick={() => setStep(2)} disabled={busy}>
                  {imported > 0 ? "Continue" : "Skip — later"}
                </Btn>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">Sync your RGB lighting</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                Connect to OpenRGB to have your devices follow the wallpaper. No
                OpenRGB yet? Skip — wallpaper-only is a perfectly good setup.
              </p>
              <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel-strong)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <ItemTitle>
                      {rgb.connected ? `${rgb.devices.length} device${rgb.devices.length === 1 ? "" : "s"} detected` : "OpenRGB not detected"}
                    </ItemTitle>
                    <div className="mt-0.5 text-xs text-[var(--text-faint)]">
                      {rgb.connected
                        ? "You're set — devices will follow the modes on the next step."
                        : "Start OpenRGB with the Server enabled, then retry."}
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
                      Retry
                    </Btn>
                  )}
                </div>
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(1)}>
                  Back
                </Btn>
                <Btn variant="primary" onClick={() => setStep(3)} disabled={busy}>
                  Continue
                </Btn>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">Your lighting mood</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                Pick how your devices behave. Ambient follows the wallpaper —
                recommended for the full effect.
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
                        <ItemTitle>{m.label}</ItemTitle>
                        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                          {m.hint}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(2)}>
                  Back
                </Btn>
                <Btn variant="primary" onClick={() => setStep(4)} disabled={busy}>
                  Continue
                </Btn>
              </div>
            </>
          )}
          {step === 4 && (
            <>
              <h1 className="lednum text-lg text-[var(--text)]">Common settings</h1>
              <p className="mt-2 text-sm leading-relaxed text-[var(--text-dim)]">
                The toggles most people change — you can fine-tune everything in
                Settings later.
              </p>
              <div className="mt-4 space-y-0.5">
                <Select<ThemeMode>
                  label="Dashboard theme"
                  value={cfg.general.theme}
                  options={[
                    { id: "dark", label: "Dark" },
                    { id: "light", label: "Light" },
                    { id: "system", label: "Follow system" },
                  ]}
                  onChange={(v) => save((c) => (c.general.theme = v))}
                />
                <Toggle
                  label="AMOLED mode"
                  description="True-black dashboard in dark theme — ideal for OLED screens."
                  checked={cfg.general.amoled ?? false}
                  onChange={(v) => save((c) => (c.general.amoled = v))}
                />
                <div className="border-t border-[var(--line)]" />
                <Toggle
                  label="Launch at startup"
                  description="Start LumenDeck with Windows."
                  checked={cfg.general.autostart}
                  onChange={(v) => save((c) => (c.general.autostart = v))}
                />
                <Toggle
                  label="Pause on fullscreen apps"
                  description="Stop wallpaper playback while a game or video fills the screen — saves GPU for what you're doing."
                  checked={cfg.general.pauseOnFullscreen}
                  onChange={(v) => save((c) => (c.general.pauseOnFullscreen = v))}
                />
                <Toggle
                  label="Pause on battery"
                  description="Freeze the wallpaper while unplugged (recommended on laptops)."
                  checked={cfg.general.pauseOnBatterySaver}
                  onChange={(v) => save((c) => (c.general.pauseOnBatterySaver = v))}
                />
                <Toggle
                  label="Windows accent follows wallpaper"
                  description="Taskbar and window highlights shift tone with your wallpaper."
                  checked={cfg.general.accentSyncEnabled}
                  onChange={(v) => save((c) => (c.general.accentSyncEnabled = v))}
                />
                <Toggle
                  label="Stickers on all monitors"
                  description="Mirror wallpaper stickers onto every display."
                  checked={cfg.sticker?.allMonitors ?? true}
                  onChange={(v) => save((c) => (c.sticker = { ...c.sticker, allMonitors: v }))}
                />
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(3)}>
                  Back
                </Btn>
                <Btn variant="primary" onClick={finish} disabled={busy}>
                  {busy ? "Saving…" : "Finish setup"}
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
            skip — set up later in settings
          </button>
        </div>
      </div>
    </div>
  );
}
