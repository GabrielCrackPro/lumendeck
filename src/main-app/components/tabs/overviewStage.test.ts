import { describe, expect, it } from "vitest";

/**
 * The Overview tab's source, read at build time.
 *
 * Through `import.meta.glob` rather than `node:fs`, as tabNav.test.ts does and
 * for the same reason: these assertions are about markup that only exists in the
 * render tree, and this environment deliberately has no DOM to render it.
 */
const OVERVIEW_SRC = import.meta.glob("./OverviewTab.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["./OverviewTab.tsx"];

function overviewSource(): string {
  if (typeof OVERVIEW_SRC !== "string") {
    throw new Error("OverviewTab.tsx was not globbed; cannot assert on its markup");
  }
  return OVERVIEW_SRC;
}

/** The Now playing card's span of the file: the stage, player and transport. */
function nowPlayingSection(src: string): string {
  const start = src.indexOf("function WallpaperStage");
  const end = src.indexOf("export default function OverviewTab");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("could not bound the Now playing section");
  }
  return src.slice(start, end);
}

describe("Now playing wallpaper stage", () => {
  it("uses the app tooltip rather than a native one, on every label", () => {
    // The stage sits over a picture, so a browser's grey system tooltip is the
    // most visible mismatch on the card. Nine sites were native: the wallpaper
    // name, the two overlay controls, the album art, the title, the source app,
    // the volume row, shuffle and repeat.
    const section = nowPlayingSection(overviewSource());
    expect(section).not.toMatch(/\btitle=\{t\(/);
    expect(section).not.toMatch(/\btitle=\{media\./);
    expect(section).not.toMatch(/\btitle=\{`/);
    expect(section).not.toMatch(/\btitle=\{wallpaperName\}/);
  });

  it("still carries the tooltip on the truncated wallpaper name", () => {
    // The chip is `truncate`, so the tooltip is the only way to read a long
    // filename in full. Losing it would make the name unrecoverable, not merely
    // less pretty.
    expect(nowPlayingSection(overviewSource())).toContain(
      "data-tip={wallpaperName}",
    );
  });

  it("keeps an accessible name on every overlay control", () => {
    // The two overlay buttons are `opacity-0` until hover, so their label is
    // the only thing a screen reader has. `aria-label` and the tooltip answer
    // different questions and both are needed: what it is for a reader, what it
    // says on hover.
    //
    // The volume row is deliberately absent: it has a visible text label beside
    // it further down the card, so an `aria-label` there would duplicate a
    // string the user can already read.
    const src = nowPlayingSection(overviewSource());
    expect(src).toContain('aria-label={t("common.change-wallpaper")}');
    expect(src).toContain('data-tip={t("common.change-wallpaper")}');
    expect(src).toContain("aria-label={t(muted ? \"common.unmute\" : \"common.mute\")}");
  });

  it("reveals the hover-only controls on keyboard focus, not hover alone", () => {
    // `opacity-0` does not remove a button from the tab order, so without
    // `focus-within` these two are reachable by Tab and completely invisible
    // while focused — the one state a control must never be in.
    expect(nowPlayingSection(overviewSource())).toContain(
      "focus-within:opacity-100",
    );
  });

  it("hides the wallpaper name at rest and brings it back on hover", () => {
    // The card is called "Now playing and live wallpaper". A permanently drawn
    // chip over the picture meant the wallpaper was never shown unobstructed.
    expect(nowPlayingSection(overviewSource())).toMatch(
      /className="absolute left-3 top-3[^"]*opacity-0[^"]*group-hover\/stage:opacity-100/,
    );
  });

  it("still shows the name to a keyboard user, who has no hover", () => {
    // The chip is not focusable, so hover-only would delete the wallpaper name
    // for keyboard users entirely rather than merely hiding it. Revealing on
    // focus anywhere in the stage means Tab to Pause or Change brings the name
    // with it. This is the assertion that stops "hover-only" from being read as
    // "mouse-only".
    expect(nowPlayingSection(overviewSource())).toContain(
      "group-focus-within/stage:opacity-100",
    );
  });

  it("fades the top scrim in with the name, not permanently", () => {
    // The gradient exists to make the chip legible against a bright frame.
    // Left always-on it darkens the top third of the wallpaper — usually the
    // part the user chose — for nothing, most of the time.
    expect(nowPlayingSection(overviewSource())).toMatch(
      /bg-\[linear-gradient[^\n]*opacity-0[^\n]*group-hover\/stage:opacity-100/,
    );
  });

  it("gives all three pieces of chrome the same reveal, so none is left behind", () => {
    // Chip, scrim and the two buttons fade together. A fourth element that kept
    // `opacity-0` with only the hover half of the pair would stay invisible to
    // keyboard users while the rest of the chrome appeared.
    const section = nowPlayingSection(overviewSource());
    const reveals = section.match(/group-hover\/stage:opacity-100/g) ?? [];
    const focusReveals = section.match(/group-focus-within\/stage:opacity-100/g) ?? [];
    expect(reveals).toHaveLength(3);
    expect(focusReveals).toHaveLength(2);
  });

  it("reserves room for the overlay controls when capping the name width", () => {
    // The chip is capped so the two buttons at top-right never overlap it. The
    // `100%-6.5rem` is that reservation; if the controls grew wider and this did
    // not, the wallpaper name would slide underneath them.
    expect(nowPlayingSection(overviewSource())).toContain(
      "max-w-[calc(100%-6.5rem)]",
    );
  });

  it("keeps the name chip a label rather than a fake control", () => {
    // It has a pill background, so a hover state would promise an action it does
    // not have. It stays a `div` with a `span` inside.
    const src = nowPlayingSection(overviewSource());
    expect(src).toMatch(
      /<div className="absolute left-3 top-3[^"]*"[\s\S]{0,400}?<span/,
    );
    expect(src).not.toMatch(/<button[^>]*onClick=\{onChange\}[^>]*data-tip=\{wallpaperName\}/);
  });
});