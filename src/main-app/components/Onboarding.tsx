// First-run onboarding: three steps, done in under a minute.
//  1. Wallpaper — pick from the vault (or keep the default)
//  2. Lighting — detect OpenRGB, or skip (wallpaper-only is a valid setup)
//  3. Mood — a starting lighting mode + accent behavior
// Skippable at any point; the app is fully usable without finishing.
import { useState } from "react";
import { useStore } from "../store";
import { api } from "../ipc";
import { Btn } from "./ui";
import { RGB_MODES } from "@shared/constants";
import type { RgbMode } from "@shared/types";

const STEPS = ["Wallpaper", "Lighting", "Mood"] as const;

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const { cfg, save } = useStore();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);

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
      setStep(2);
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
                  <div className="text-sm font-semibold text-[var(--text)]">
                    {cfg.gallery.length > 0
                      ? `${cfg.gallery.length} wallpapers in your vault`
                      : "Your vault is empty"}
                  </div>
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

          {step === 2 && (
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
                        className={`rounded-xl border p-3.5 text-left transition-all ${
                          active
                            ? "border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] ring-1 ring-[rgb(var(--glow)/0.3)]"
                            : "border-[var(--line)] hover:border-[var(--line-strong)]"
                        }`}
                      >
                        <div className="text-sm font-semibold text-[var(--text)]">{m.label}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-faint)]">
                          {m.hint}
                        </div>
                      </button>
                    );
                  },
                )}
              </div>
              <div className="mt-6 flex justify-between">
                <Btn variant="ghost" onClick={() => setStep(0)}>
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
