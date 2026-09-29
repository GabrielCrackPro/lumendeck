import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import { api } from "../ipc";
import { Card, InfoNote, Btn } from "./ui";
import { HOTKEY_ACTIONS, type HotkeyActionId } from "@shared/constants";
import type { HotkeyConfig } from "@shared/types";
import { acceleratorFromEvent, isSafeAccelerator, parseAccelerator } from "../eq";
import { truncateError } from "../utilities";

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
  onChange,
}: {
  label: string;
  description: string;
  suggested: string;
  value: string;
  /** Accelerator already used by a different action, if any. */
  conflict: string | null;
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
    <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-3 last:border-b-0">
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
        {!error && conflict && (
          <div className="mt-1 text-[11px] leading-relaxed text-amber-300/90">
            Already used by another action — the first one bound wins.
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {recording ? (
          <span className="flex h-9 min-w-[132px] items-center justify-center rounded-lg border border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.08)] px-3 font-mono text-[11px] text-[rgb(var(--glow))]">
            {pending ?? "press keys…"}
          </span>
        ) : value ? (
          <ComboChips accelerator={value} />
        ) : (
          // Ghost hint rather than a blank: the suggestion is the affordance.
          <span
            className="font-mono text-[11px] text-[var(--text-faint)]/60"
            title={`Suggested: ${suggested}`}
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
          {recording ? "Cancel" : value ? "Change" : "Set"}
        </Btn>
        {value && !recording && (
          <Btn size="sm" variant="ghost" onClick={() => onChange("")}>
            Clear
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
  const hotkeys = useStore((s) => s.cfg?.general.hotkeys);
  const save = useStore((s) => s.save);
  // While a row is recording, the value under it has not been written yet, so
  // duplicate detection needs the pending combo too. Tracked here rather than
  // in each row so every row agrees on who has what.
  const [draft, setDraft] = useState<{ id: HotkeyActionId; accel: string } | null>(null);

  if (!hotkeys) return null;
  const cfg: HotkeyConfig = hotkeys;

  const valueFor = (id: HotkeyActionId) =>
    draft && draft.id === id ? draft.accel : (cfg[id]?.accelerator ?? "");

  const boundBy = (accel: string, except: HotkeyActionId) => {
    for (const a of HOTKEY_ACTIONS) {
      if (a.id === except) continue;
      if ((cfg[a.id]?.accelerator ?? "").toLowerCase() === accel.toLowerCase()) {
        return a.label;
      }
    }
    return null;
  };

  const anyBound = HOTKEY_ACTIONS.some(
    (a) => (cfg[a.id]?.accelerator ?? "").trim() !== "",
  );

  return (
    <Card
      title="Global hotkeys"
      right={
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
          Use suggestions
        </Btn>
      }
    >
      <div className="px-4 py-1">
        {!anyBound && (
          <div className="pb-3 pt-1">
            <InfoNote>
              No keys are taken right now — LumenDeck never grabs a key you
              did not ask for. Pick an action, press <b>Set</b>, then press the
              combo. They keep working while the dashboard is closed.
            </InfoNote>
          </div>
        )}
        {HOTKEY_ACTIONS.map((a) => {
          const accel = valueFor(a.id);
          return (
            <HotkeyRow
              key={a.id}
              label={a.label}
              description={a.description}
              suggested={a.suggested}
              value={accel}
              conflict={accel ? boundBy(accel, a.id) : null}
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
          Combos need a modifier (Ctrl, Alt, Shift or Win) or an F1-F24 key,
          so a binding can never swallow the key you are typing. If another
          app already owns a combo, LumenDeck says so instead of failing
          quietly.
        </div>
      </div>
    </Card>
  );
}
