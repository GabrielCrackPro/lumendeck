import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../ipc";
import { Card, InfoNote, Btn, Toggle, Slider, ColorInput } from "./ui";
import { HOTKEY_ACTIONS, type HotkeyActionId } from "@shared/constants";
import type { HotkeyConfig } from "@shared/types";
import { acceleratorFromEvent, isSafeAccelerator, parseAccelerator } from "../eq";
import { truncateError } from "../utilities";
import { t } from "../i18n";

/** Mirrors `default_hotkey_blink_color` in src-tauri/src/config.rs. */
const DEFAULT_BLINK_COLOR: [number, number, number] = [255, 255, 255];

/** Pretty labels for the modifier tokens, so the binding reads like a menu. */
const MODIFIER_LABELS: Record<string, string> = {
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  Super: "Win",
};

/** Render an accelerator as individual key chips. */
function ComboChips({ accelerator }: { accelerator: string }) {
  const parsed = parseAccelerator(accelerator);
  if (!parsed) {
    return (
      <span className="font-mono text-[11px] text-red-300">{accelerator}</span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      {[...parsed.modifiers, parsed.key].map((token, i) => (
        <kbd
          key={`${token}-${i}`}
          className="rounded-md border border-[var(--line-strong)] bg-[var(--panel-strong)] px-1.5 py-0.5 font-mono text-[10.5px] leading-none text-[var(--text)]"
        >
          {MODIFIER_LABELS[token] ?? token}
        </kbd>
      ))}
    </span>
  );
}

/**
 * One action row: label, description, and a combo field.
 *
 * Click the field to arm the recorder, then press the combo. Escape cancels,
 * Backspace/Delete clears. While armed, the listener runs in the capture
 * phase on the window and swallows every key so the combo does not also fire
 * whatever shortcut the dashboard has bound to it.
 */
function HotkeyRow({
  label,
  description,
  suggested,
  value,
  conflict,
  refused,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  suggested: string;
  value: string;
  /** Accelerator already used by a different action, if any. */
  conflict: string | null;
  /**
   * Why the OS would not take this combo, if it refused it. Distinct from
   * `conflict`: that is a clash inside this app (the other row wins), while
   * this is another program on the machine owning the keys.
   */
  refused: string | null;
  /** Master switch is off: the row is inert but its binding is kept. */
  disabled: boolean;
  onChange: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(() => {
    setRecording(false);
    setPending(null);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      // Capture phase + preventDefault: the combo being recorded must not
      // also reach the dashboard's own shortcuts.
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        finish();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        onChange("");
        finish();
        return;
      }
      const accel = acceleratorFromEvent(e);
      // null = a modifier on its own, or a key the grammar has no name for.
      if (!accel) return;
      setPending(accel);
      // The backend owns the grammar, so it gets the final say on whether the
      // OS would accept this. Checked client-side first to skip the round trip
      // on the obvious cases.
      if (!isSafeAccelerator(accel)) {
        setError("Add Ctrl, Alt, Shift or Win — a bare key would be taken everywhere.");
        return;
      }
      api.hotkeyValidate(accel).then(
        () => {
          setError(null);
          onChange(accel);
          finish();
        },
        (e) => setError(truncateError(e, 90)),
      );
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [recording, onChange, finish]);

  return (
    <div
      className={`flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 transition-opacity last:border-b-0 ${
        disabled ? "pointer-events-none opacity-40" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="text-sm text-[var(--text)]">{label}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-[var(--text-faint)]">
          {description}
        </div>
        {error && (
          <div className="mt-1 text-[11px] leading-relaxed text-red-300">
            {error}
          </div>
        )}
        {!error && refused && (
          <div
            className="mt-1 text-[11px] leading-relaxed text-red-300"
            // The raw OS message is debug-flavoured (`HotKey { mods: … }`), so
            // the row says it in plain words and keeps the original in the
            // tooltip for anyone reporting a bug.
            title={refused}
          >
            {t("hotkeys.not-active-this-combo-is-taken-so-the-key-does-n")}
          </div>
        )}
        {!error && !refused && conflict && (
          <div className="mt-1 text-[11px] leading-relaxed text-amber-300/90">
            {t("hotkeys.already-used-by-another-action-the-first-one-bou")}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {recording ? (
          <span className="flex h-9 min-w-[132px] items-center justify-center rounded-lg border border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] px-3 font-mono text-[11px] text-[rgb(var(--glow))]">
            {pending ?? t("hotkeys.press-keys")}
          </span>
        ) : value ? (
          <ComboChips accelerator={value} />
        ) : (
          // Ghost hint rather than a blank: the suggestion is the affordance.
          <span
            className="font-mono text-[11px] text-[var(--text-faint)]/60"
            title={t("hotkeys.suggested-{combo}", { combo: suggested })}
          >
            {suggested}
          </span>
        )}
        <Btn
          size="sm"
          variant={recording ? "primary" : "default"}
          onClick={() => {
            setError(null);
            setRecording((r) => !r);
          }}
        >
          {recording ? t("hotkeys.cancel") : value ? t("hotkeys.change") : t("hotkeys.set")}
        </Btn>
        {value && !recording && (
          <Btn size="sm" variant="ghost" onClick={() => onChange("")}>
            {t("hotkeys.clear")}
          </Btn>
        )}
      </div>
    </div>
  );
}

/**
 * Global hotkeys settings.
 *
 * Nothing is bound on a fresh install — see `HotkeyBinding` in config.rs for
 * why. This card therefore leads with the suggestion rather than a value, so
 * the affordance is "here is a combo you probably want, press it to take it"
 * instead of an empty column of dashes.
 */
export default function HotkeysCard() {
  const general = useStore((s) => s.cfg?.general);
  const save = useStore((s) => s.save);
  // What the OS actually took on the last registration pass. Matched on the
  // combo as well as the action, so a binding edited since the last pass does
  // not inherit the previous combo's warning.
  const failures = useStore((s) => s.hotkeyFailures);
  // While a row is recording, the value under it has not been written yet, so
  // duplicate detection needs the pending combo too. Tracked here rather than
  // in each row so every row agrees on who has what.
  const [draft, setDraft] = useState<{ id: HotkeyActionId; accel: string } | null>(null);

  if (!general) return null;
  const cfg: HotkeyConfig = general.hotkeys;
  // Older configs predate the switch; absence means on, matching the Rust
  // default so the dashboard and the tray can never disagree about it.
  const enabled = general.hotkeysEnabled ?? true;
  const boundCount = HOTKEY_ACTIONS.filter(
    (a) => (cfg[a.id]?.accelerator ?? "").trim() !== "",
  ).length;

  const valueFor = (id: HotkeyActionId) =>
    draft && draft.id === id ? draft.accel : (cfg[id]?.accelerator ?? "");

  const boundBy = (accel: string, except: HotkeyActionId) => {
    for (const a of HOTKEY_ACTIONS) {
      if (a.id === except) continue;
      if ((cfg[a.id]?.accelerator ?? "").toLowerCase() === accel.toLowerCase()) {
        return t(a.label);
      }
    }
    return null;
  };

  const anyBound = boundCount > 0;
  // Older configs predate the blink; absence means on, matching the Rust
  // default so the card can never show a toggle the backend would ignore.
  const blinkMs = general.hotkeyBlinkMs ?? 450;
  const blinkColor = general.hotkeyBlinkColor ?? DEFAULT_BLINK_COLOR;

  return (
    <Card
      title={t("hotkeys.global-hotkeys")}
      right={
        enabled && (
          <Btn
            size="sm"
            variant="ghost"
            onClick={() => {
              // Fill every empty action with its suggestion in one save, so a
              // user who wants the whole set does not click twelve times.
              const next: Record<string, string> = {};
              for (const a of HOTKEY_ACTIONS) {
                next[a.id] = cfg[a.id]?.accelerator || a.suggested;
              }
              save((c) => {
                for (const a of HOTKEY_ACTIONS) {
                  c.general.hotkeys[a.id] = {
                    accelerator: next[a.id] ?? a.suggested,
                  };
                }
              });
            }}
          >
            {t("hotkeys.use-suggestions")}
          </Btn>
        )
      }
    >
      <div className="px-4 py-1">
        <div className="border-b border-[var(--line)] py-3">
          <Toggle
            label={t("hotkeys.enable-global-hotkeys")}
            description={
              anyBound
                ? t("hotkeys.bound-actions-description", {
                    n: boundCount,
                    total: HOTKEY_ACTIONS.length,
                  })
                : t("hotkeys.no-bindings-yet-description")
            }
            checked={enabled}
            onChange={(v) => save((c) => (c.general.hotkeysEnabled = v))}
          />
        </div>
        {/* ---- blink feedback: lives with the bindings because it is a
            reaction to them, not a general lighting preference ---- */}
        <div
          className={`border-b border-[var(--line)] py-3 transition-opacity ${
            enabled ? "" : "pointer-events-none opacity-40"
          }`}
        >
          <Toggle
            label={t("hotkeys.blink-the-keys-when-a-hotkey-fires")}
            description={t("hotkeys.flash-the-keyboard-backlight-so-you-can-tell-a-c")}
            checked={blinkMs > 0}
            onChange={(v) =>
              save((c) => (c.general.hotkeyBlinkMs = v ? blinkMs || 450 : 0))
            }
          />
          {blinkMs > 0 && (
            <div className="mt-3 space-y-3 pl-1">
              <Slider
                label={t("hotkeys.blink-duration")}
                min={150}
                max={1000}
                step={50}
                value={blinkMs}
                format={(v) => `${v} ms`}
                onChange={(v) => save((c) => (c.general.hotkeyBlinkMs = v))}
              />
              <ColorInput
                label={t("hotkeys.blink-color")}
                value={blinkColor}
                onChange={(v) => save((c) => (c.general.hotkeyBlinkColor = v))}
              />
            </div>
          )}
        </div>
        {enabled && !anyBound && (
          <div className="pb-3 pt-3">
            <InfoNote>
              {t("hotkeys.no-keys-are-taken-right-now-lumendeck-never-grab")}{" "}
              <b>{t("hotkeys.set")}</b>
              {t("hotkeys.then-press-the-combo-they-keep-working-while-the")}
            </InfoNote>
          </div>
        )}
        {HOTKEY_ACTIONS.map((a) => {
          const accel = valueFor(a.id);
          return (
            <HotkeyRow
              key={a.id}
              label={t(a.label)}
              description={t(a.description)}
              suggested={a.suggested}
              value={accel}
              conflict={accel ? boundBy(accel, a.id) : null}
              refused={
                enabled && accel
                  ? (failures.find(
                      (f) => f.action === a.id && f.accelerator === accel,
                    )?.message ??
                    null)
                  : null
              }
              disabled={!enabled}
              onChange={(next) => {
                setDraft({ id: a.id, accel: next });
                save((c) => {
                  c.general.hotkeys[a.id] = { accelerator: next };
                });
              }}
            />
          );
        })}
        <div className="py-3 text-[11px] leading-relaxed text-[var(--text-faint)]">
          {t("hotkeys.combos-need-a-modifier-ctrl-alt-shift-or-win-or")}
        </div>
      </div>
    </Card>
  );
}
