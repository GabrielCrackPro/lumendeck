// The mode picker: eight ways for the lights to behave, each showing itself
// running rather than describing itself.
//
// The tiles are animated canvases, not icons — a mode you can watch is the
// fastest way to understand it, and the alternative (a name and a hint) made
// every mode a guessing game. That only works if the maths is trustworthy, so
// the colour comes from `rgbStrip`, which is a port of the Rust engine's own
// and is tested against it.

import { ModePreview } from "../ModePreview";
import {
  IconCheck,
  IconGrid,
  IconModeAmbient,
  IconModeAudio,
  IconModeBreathe,
  IconModeCycle,
  IconModePulse,
  IconModeStatic,
  IconModeWave,
  type Glyph,
} from "../icons";
import { RGB_MODES } from "@shared/constants";
import { t } from "../../i18n";
import type { Rgb } from "../rgbStrip";
import type { AudioLevel, RgbMode } from "@shared/types";

/**
 * Per-mode icon, from the app's icon set — the glyphs live in `icons.tsx` with
 * everything else so they get the same hover animation and reduced-motion
 * handling as the rest, which is exactly what the private hand-drawn set they
 * replaced never had.
 */
const MODE_ICONS: Record<RgbMode, Glyph> = {
  ambient: IconModeAmbient,
  zone: IconGrid,
  pulse: IconModePulse,
  static: IconModeStatic,
  cycle: IconModeCycle,
  wave: IconModeWave,
  breathe: IconModeBreathe,
  audioReactive: IconModeAudio,
};

export interface ModePickerProps {
  mode: RgbMode;
  staticColor: Rgb;
  liveColor: Rgb | null;
  speed: number;
  brightness: number;
  saturation: number;
  audio: AudioLevel;
  cycleSpread: number;
  waveDirection: 1 | -1;
  onPick: (mode: RgbMode) => void;
}

export function ModePicker(props: ModePickerProps) {
  const { mode, onPick } = props;
  const groups = [
    {
      id: "reactive",
      title: "lighting.reactive-to-wallpaper",
      hint: "lighting.color-follows-the-screen",
      modes: RGB_MODES.filter((m) => m.group === "reactive"),
    },
    {
      id: "animation",
      title: "lighting.animated",
      hint: "lighting.self-driven-motion",
      modes: RGB_MODES.filter((m) => m.group === "animation"),
    },
  ];

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section key={group.id}>
          {/* The group heading carries its own explanation, so the two halves
              sit on one baseline rather than the hint drifting to the far edge
              of a wide card. */}
          <header className="mb-2 flex items-baseline gap-3">
            <h3 className="kicker shrink-0">{t(group.title)}</h3>
            <span
              aria-hidden
              className="h-px flex-1 translate-y-[-2px] bg-[var(--line)]"
            />
            <span className="shrink-0 font-mono text-[9.5px] text-[var(--text-faint)]">
              {t(group.hint)}
            </span>
          </header>
          <div className="grid grid-cols-1 gap-2.5 @[22rem]:grid-cols-2 @[38rem]:grid-cols-4">
            {group.modes.map((m) => {
              const id = m.id as RgbMode;
              const active = mode === id;
              const ModeGlyph = MODE_ICONS[id];
              return (
                <button
                  key={id}
                  onClick={() => onPick(id)}
                  data-tip={t(m.hint)}
                  aria-pressed={active}
                  className={`group flex w-full flex-col overflow-hidden rounded-xl border text-left transition-all duration-200 active:scale-[0.98] ${
                    active
                      ? "border-[rgb(var(--glow)/0.55)] shadow-[0_10px_30px_-12px_rgb(var(--glow)/0.6)] ring-1 ring-[rgb(var(--glow)/0.3)]"
                      : "border-[var(--line)] hover:border-[var(--line-strong)] hover:shadow-[0_4px_16px_-8px_rgb(var(--glow)/0.35)]"
                  }`}
                >
                  {/* In normal flow, not absolutely positioned: the text below
                      must never be able to overlap the preview. */}
                  <span className="relative block h-14 w-full shrink-0">
                    <ModePreview
                      mode={id}
                      staticColor={props.staticColor}
                      liveColor={props.liveColor}
                      speed={props.speed}
                      brightness={props.brightness}
                      saturation={props.saturation}
                      active={active}
                      audioVolume={props.audio.volume}
                      cycleSpread={props.cycleSpread}
                      waveDirection={props.waveDirection}
                    />
                    <span className="pointer-events-none absolute inset-0 rounded-t-xl ring-1 ring-inset ring-[rgb(255_255_255/0.06)]" />
                    {/* A check rather than an "ON" pill: it needs no word in
                        any language, and it cannot fight the preview for
                        attention the way a filled badge did. */}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--glow))] text-black/85 shadow-[0_2px_8px_rgb(var(--glow)/0.5)]">
                        <IconCheck className="h-3 w-3" />
                      </span>
                    )}
                  </span>
                  <span
                    className={`flex w-full items-center gap-2 border-t px-2.5 py-2 transition-colors ${
                      active
                        ? "border-[rgb(var(--glow)/0.25)] bg-[rgb(var(--glow)/0.07)]"
                        : "border-transparent bg-[var(--panel-strong)] group-hover:bg-[var(--panel)]"
                    }`}
                  >
                    <ModeGlyph
                      className={`h-4 w-4 shrink-0 ${
                        active
                          ? "text-[rgb(var(--glow))]"
                          : "text-[var(--text-faint)] group-hover:text-[var(--text-dim)]"
                      }`}
                    />
                    <span
                      className={`truncate text-[12.5px] font-semibold leading-tight ${
                        active ? "text-[rgb(var(--glow))]" : "text-[var(--text)]"
                      }`}
                    >
                      {t(m.label)}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}