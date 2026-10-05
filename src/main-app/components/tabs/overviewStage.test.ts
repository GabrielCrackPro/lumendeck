import { describe, expect, it } from "vitest";

/**
 * The Now playing card's source, read at build time.
 *
 * Through `import.meta.glob` rather than `node:fs`, as tabNav.test.ts does and
 * for the same reason: these assertions are about markup that only exists in
 * the render tree, and this environment deliberately has no DOM to render it.
 *
 * The markup moved from OverviewTab.tsx into overview/MediaCard.tsx when the
 * tab was split; the assertions did not. The tab now renders `<MediaCardBody>`,
 * so bounding the card's own file is what keeps these assertions about the
 * same pixels they were always about.
 */
const MEDIA_SRC = import.meta.glob("../overview/MediaCard.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
})["../overview/MediaCard.tsx"];

function mediaCardSource(): string {
  if (typeof MEDIA_SRC !== "string") {
    throw new Error("MediaCard.tsx was not globbed; cannot assert on its markup");
  }
  return MEDIA_SRC;
}

/** The wallpaper stage alone, for assertions about what sits over the picture. */
function wallpaperStage(src: string): string {
  const start = src.indexOf("function WallpaperStage");
  const end = src.indexOf("function EqBars");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("could not bound the wallpaper stage");
  }
  return src.slice(start, end);
}

/** The Now playing card's span of the file: the stage, player and transport. */
function nowPlayingSection(src: string): string {
  const start = src.indexOf("function WallpaperStage");
  const end = src.indexOf("export default function MediaCardBody");
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
    const section = nowPlayingSection(mediaCardSource());
    expect(section).not.toMatch(/\btitle=\{t\(/);
    expect(section).not.toMatch(/\btitle=\{media\./);
    expect(section).not.toMatch(/\btitle=\{`/);
    expect(section).not.toMatch(/\btitle=\{wallpaperName\}/);
  });

  it("still carries the tooltip on the truncated wallpaper name", () => {
    // The chip is `truncate`, so the tooltip is the only way to read a long
    // filename in full. Losing it would make the name unrecoverable, not merely
    // less pretty.
    expect(nowPlayingSection(mediaCardSource())).toContain(
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
    const src = nowPlayingSection(mediaCardSource());
    expect(src).toContain('aria-label={t("common.change-wallpaper")}');
    expect(src).toContain('data-tip={t("common.change-wallpaper")}');
    expect(src).toContain("aria-label={t(muted ? \"common.unmute\" : \"common.mute\")}");
  });

  it("draws the wallpaper name and its actions at rest, not on hover", () => {
    // The name and the two wallpaper actions used to be chrome over the
    // picture, revealed by hover and by focus-within. That treatment is right
    // for artwork and wrong for a name: a label that vanishes when the pointer
    // leaves is a hover hint, and the one thing a reader could not do without
    // it was answer "which wallpaper is this" while looking at it.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toContain("data-tip={wallpaperName}");
    expect(stage).not.toMatch(/group-hover\/stage/);
    expect(stage).not.toMatch(/group-focus-within\/stage/);
    expect(stage).not.toMatch(/focus-within:opacity-100/);
  });

  it("keeps nothing hidden at rest over the picture", () => {
    // With the chrome gone there is no reason for the top scrim either: it
    // existed to make a chip legible against a bright frame, and it darkened
    // the top third of an image the user chose for the rest of the time.
    //
    // Scoped to the stage on purpose. The progress bar further down this same
    // card hides its scrub thumb until hover, which is correct — a thumb that
    // was always visible would sit on top of the elapsed line.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).not.toMatch(/opacity-0/);
    expect(stage).not.toMatch(/bg-\[linear-gradient/);
  });

  it("sits the name beside the actions rather than under them", () => {
    // `flex-1 truncate` is what replaces the width reservation the overlay
    // needed: the name takes the room the two buttons are not using, so a
    // longer filename still has somewhere to go.
    expect(wallpaperStage(mediaCardSource())).toContain(
      'className="min-w-0 flex-1 truncate',
    );
  });

  it("keeps the name a label rather than a fake control", () => {
    // It is not a button and never was; a hover state on it would promise an
    // action it does not have.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toMatch(/data-tip=\{wallpaperName\}[\s\S]{0,200}?<\/span>/);
    expect(stage).not.toMatch(/<button[^>]*onClick=\{onChange\}[^>]*data-tip=\{wallpaperName\}/);
  });

  it("says when the wallpaper is paused, rather than only going still", () => {
    // A frozen picture is otherwise indistinguishable from a still frame, and
    // the old card reported a paused wallpaper three other ways on three other
    // screens.
    expect(wallpaperStage(mediaCardSource())).toContain('{t("common.paused")}');
  });
});
