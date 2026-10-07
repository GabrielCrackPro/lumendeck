import { describe, expect, it } from "vitest";

/**
 * The Now playing card's source, read at build time.
 *
 * Through `import.meta.glob` rather than `node:fs`, as tabNav.test.ts does and
 * for the same reason: these assertions are about markup that only exists in
 * the render tree, and this environment deliberately has no DOM to render it.
 *
 * The markup lives in overview/MediaCard.tsx (via the exported `MediaCardBody`),
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

/**
 * The wallpaper stage alone, for assertions about what sits over the picture.
 */
function wallpaperStage(src: string): string {
  const start = src.indexOf("function WallpaperStage");
  const end = src.indexOf("function EqBars");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("could not bound the wallpaper stage");
  }
  return src.slice(start, end);
}

/**
 * The Now playing card's span of the file: the stage, the player pieces the
 * stage docks (identity, transport, timeline, volume) and the transport cluster.
 *
 * Separate from `wallpaperStage` on purpose, and the distinction is what two
 * different kinds of assertion need. "What sits over the picture" has to stay
 * bounded to the stage or it stops meaning that — the stage's own no-border
 * bleed assertion fails the moment album art (`border border-[...]`) is in
 * scope. "Every control in this card is named" has to span everything the card
 * renders, or it silently checks only the half of the controls that happen to
 * be declared above the first helper: the mute button lives in
 * `VolumeControl`, far below the stage.
 */
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

  it("still carries the wallpaper name as a tooltip on its glyph", () => {
    // The name is no longer printed on the picture (see the test below), so this
    // tooltip is the only place the filename appears on this card — the thing
    // that keeps it recoverable rather than simply gone. It has to be the app's
    // tooltip, not a native one: this strip sits over a wallpaper.
    expect(wallpaperStage(mediaCardSource())).toContain(
      "data-tip={wallpaperName}",
    );
  });

  it("keeps an accessible name on every overlay control", () => {
    // The two overlay buttons are `opacity-0` until hover, so their label is
    // the only thing a screen reader has. `aria-label` and the tooltip answer
    // different questions and both are needed: what it is for a reader, what it
    // says on hover.
    // The volume slider is named on the control itself: this card no longer
    // prints a visible "System volume" label beside it, so the string's only
    // other appearance is the tooltip on the row — hover copy, which is not an
    // accessible name.
    const src = nowPlayingSection(mediaCardSource());
    expect(src).toContain('aria-label={t("common.change-wallpaper")}');
    expect(src).toContain('data-tip={t("common.change-wallpaper")}');
    expect(src).toContain(
      'aria-label={t(muted ? "common.unmute" : "common.mute")}',
    );
    expect(src).toContain('aria-label={t("common.system-volume")}');
  });

  it("marks the countdown toggle as a control at rest, not only on hover", () => {
    // The total label doubles as the remaining-time switch, and hover used to be
    // the only thing that said so — a clock nobody can see is a button never gets
    // clicked. The underline is the gallery's own cue for clickable text, so it
    // reads as a control without a border pad (a chip would clip a seven-character
    // time), accent marks the state an underline cannot show, and focus-glow is
    // what the keyboard lands on.
    const src = nowPlayingSection(mediaCardSource());
    const start = src.lastIndexOf("<button", src.indexOf("common.toggle-remaining-time"));
    const toggle = src.slice(start, src.indexOf("</button>", start));
    expect(toggle).toContain("underline underline-offset-2");
    expect(toggle).toContain("focus-glow");
    expect(toggle).toContain("text-[rgb(var(--glow))]");
    expect(toggle).toContain("text-[var(--text-faint)]");
  });

  it("reveals the wallpaper identity rail on hover and on focus-within", () => {
    // The glyph that carries the wallpaper's name, its paused badge and the two
    // wallpaper actions sit over the picture, but as a rail that hides until the
    // reader asks for it: pointer on the picture, or focus inside the stage. That
    // is the right treatment for a strip of controls drawn on a wallpaper: the
    // card is already labelled "Now playing" in the tab header, the track identity
    // lower in the dock is the always-visible one, and the name is recoverable
    // because the rail brings the tooltip, the accessible name, and the paused
    // badge back with it.
    //
    // One shared transition drives the reveal, so hover on the picture and
    // focus-within on the stage both pull the rail in together. The rail itself is
    // the `group` target: not a per-control reveal: which is what keeps the rail
    // and the buttons moving as one surface.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toContain("data-tip={wallpaperName}");
    expect(stage).toContain("group-hover:opacity-100");
    expect(stage).toContain("group-focus-within:opacity-100");
    // The rail starts hidden; it is the one thing over the picture that is opacity-0
    // at rest. Anything else hidden at rest over the picture is a regression (see the
    // next test).
    expect(stage).toMatch(/opacity-0/);
  });

  it("keeps the picture clear of hidden labels at rest except the identity rail", () => {
    // At rest over the picture there is exactly one thing that is hidden (opacity-0):
    // the wallpaper identity rail. Nothing else hangs over the picture: the gradient
    // that used to dissolve the rail into the frame went, because read from the page
    // it was a shadow band drawn across the wallpaper rather than a transition. The
    // dock's dissolve is the seam of a filled strip meeting the picture, not a band
    // over open frame. Anything else hidden at rest over the picture: a label the
    // reader needs, a scrim darkening the picture to make a chip readable, a control
    // with no visible state: is a regression.
    //
    // The rail is now a transparent strip: it carries no color-mix frost, no blur, and
    // no inset glow wash, so a reader sees the picture through it untouched until it is
    // fully revealed. The dock is the frosted strip: color-mix frost + blur + the inset
    // glow wash: the only frosted surface in the stage: which is what tints the player
    // by the picture behind it. Copy still sits only on strips, never on a gradient.
    //
    // Scoped to the stage on purpose. The progress bar further down this same card
    // shows its thumb only while the track plays or the pointer is on it, and keeps
    // its seek bubble for hover and scrub: the bubble is the thing that would sit
    // on top of the elapsed label if it were always visible.
    const stage = wallpaperStage(mediaCardSource());

    // The pause badge is part of the rail, so it is still present (the code string is
    // present even when the badge itself is hidden by the rail). It is the
    // always-visible identity signal: a frozen picture is otherwise indistinguishable
    // from a still frame. The rail brings the tooltip, the accessible name and the badge
    // with it.
    expect(stage).toContain('{t("common.paused")}');

    // The dock still blends into the picture above it — the one gradient left over
    // the frame, and it carries no copy. The rail deliberately has no seam: a gradient
    // hanging under the strip was the box shadow drawn across the picture.
    expect(stage).not.toContain("top-full");
    expect(stage).toContain("bottom-full");

    // One shared transition drives the reveal, so the whole rail surface: the strip
    // and its fade-in: is the exact one thing that is opacity-0 at rest over the
    // picture. The fades are separate spans; this counts the total
    // transitions authored in the stage, any number of which are private and correct for
    // the reveal; the real guard is the next block.
    expect(stage).toMatch(/opacity-0/);

    // Classify each className attribute in the stage. The dock is the one frosted,
    // blurred, and washed strip. The rail is the one strip that is transparent (no frost,
    // no blur, no wash) and also hides at rest (opacity-0). Copy still sits only on
    // strips, never on a gradient: the dock's dissolve is the only one left, and it
    // carries no copy.
    const classNames = [...stage.matchAll(/className="([^"]*)"/g)]
      .map((m) => m[1])
      .filter((c): c is string => c !== undefined);

    const FROST = /\[color-mix\(in_srgb,var\(--bg\)_92%,transparent\)\]/;
    const BLUR = /backdrop-blur-xl/;
    const WASH = /inset_0_0_0_999px_rgb\(var\(--glow\)\/0\.06\)/;

    const frostedDock = classNames.filter(
      (c) => FROST.test(c) && BLUR.test(c) && WASH.test(c),
    );
    const rail = classNames.find(
      (c) =>
        /opacity-0/.test(c) &&
        !FROST.test(c) &&
        !BLUR.test(c) &&
        !WASH.test(c),
    );

    // Exactly one frosted, blurred, and washed strip: the dock; exactly one
    // transparent, blurless, washless strip that is also opacity-0 at rest: rail.
    expect(frostedDock).toHaveLength(1);
    expect(rail).toBeDefined();

    // The rail is the one element that is transparent, blurless, and washless, and it is
    // the one that is opacity-0 at rest. The dock is the frosted, blurred, and washed
    // one.
    expect(FROST.test(rail!)).toBe(false);
    expect(BLUR.test(rail!)).toBe(false);
    expect(WASH.test(rail!)).toBe(false);
    const dock = frostedDock[0]!;
    expect(dock).not.toBe(rail);

    // The rail starts hidden; the dock is always visible. The rail brings its tooltip,
    // its accessible name and the paused badge with it, so nothing a reader needs is
    // unavailable at rest.
    //
    // The classifier above answers "which element"; these assertions are about what
    // that element *carries*, so slice its source — from its own className to the dock
    // that follows it — rather than reading the class list as though it were markup.
    const railIdx = stage.indexOf(`className="${rail}"`);
    expect(railIdx).toBeGreaterThan(-1);
    const railMarkup = stage.slice(
      railIdx,
      stage.indexOf("absolute inset-x-0 bottom-0"),
    );
    expect(railMarkup).toContain("data-tip={wallpaperName}");
    expect(railMarkup).toMatch(/opacity-0/);
    // Nothing sits behind the strip and nothing is printed on it either: the name
    // lost to the picture, so the rail carries a glyph, a badge and two controls —
    // and no gradient may come back under it, because that band read as a box
    // shadow drawn across the picture.
    expect(railMarkup).not.toMatch(/>\s*\{wallpaperName\}/);
    expect(railMarkup).not.toMatch(/linear-gradient/);
    expect(dock).not.toMatch(/opacity-0/);
  });

  it("bleeds into the card it lives in instead of drawing a second one", () => {
    // The complaint this exists for: a bordered, rounded frame inside the
    // Card primitive's padding reads as a card inside a card. The card is the
    // frame: the hero carries no border of its own, cancels the primitive's
    // p-4 so its edges meet the card's own border, and rounds only its bottom
    // corners. The `-m-4` assertion pins the bleed to that padding: if the
    // primitive's padding ever changes, this forces both to move together.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).not.toMatch(/border border-\[/);
    expect(stage).toContain("-m-4");
    expect(stage).toContain("rounded-b-[var(--radius-xl)]");
  });

  it("keeps the wallpaper name off the picture", () => {
    // The printed name was the one piece of copy over an arbitrary frame and it
    // lost: 10.5px of accent type over a bright wallpaper is unreadable however
    // much halo it carries, and the fix for that — a scrim — would darken a
    // picture the user chose for the rest of the time. The picture stays clear;
    // what is left of the name is the tooltip on its glyph (asserted above) and
    // the jump link at the foot of the tab.
    expect(wallpaperStage(mediaCardSource())).not.toMatch(
      />\s*\{wallpaperName\}/,
    );
  });

  it("keeps the name a label rather than a fake control", () => {
    // It is not a button and never was; a hover state on it would promise an
    // action it does not have.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toMatch(
      /data-tip=\{wallpaperName\}[\s\S]{0,200}?<\/span>/,
    );
    expect(stage).not.toMatch(
      /<button[^>]*onClick=\{onChange\}[^>]*data-tip=\{wallpaperName\}/,
    );
  });

  it("says when the wallpaper is paused, rather than only going still", () => {
    // A frozen picture is otherwise indistinguishable from a still frame, and
    // the old card reported a paused wallpaper three other ways on three other
    // screens.
    expect(wallpaperStage(mediaCardSource())).toContain('{t("common.paused")}');
  });

  it("keeps the section title in the tab header, not inside the stage", () => {
    // The Now playing header is the tab's own chip, not another label inside the
    // frame. The stage should not render any of the localized section titles that
    // the tab already owns, because carrying them here would be the first step
    // toward a second competing title on the same card.
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).not.toContain('overview.now-playing');
    expect(stage).not.toContain('overview.paused-track');
  });

  it("keeps the player as one dock instead of splitting it into several panels", () => {
    // The rework target for this card: the identity rail, transport cluster,
    // volume row and timeline are all part of one bottom dock, not separate
    // bordered boxes pasted onto the picture. The existing assertions already
    // pin the hero bleed; this one is the regen guard for the player surface
    // itself.
    const body = mediaCardSource();
    // The dock is the only frosted container that holds the player pieces.
    expect(body).toContain("absolute inset-x-0 bottom-0");
    // The identity and transport pieces are inside that dock, not wrapped as
    // their own framed cards.
    expect(body).toContain("track-swap");
    // The volume row is still its own line — named on the slider itself now —
    // but not its own panel.
    expect(body).toContain('aria-label={t("common.system-volume")}');
    // The timeline is the only thing that bleeds out of the dock — sideways, to
    // the frame's full width — and it keeps eight points of air at the bottom
    // rather than sitting flush against the card's edge.
    expect(body).toContain("-mx-3 -mb-1 mt-2");
    // The regen counters: the body still has to be the one export that makes the
    // card a player, and the buttons that make it one still have to exist.
    expect(body).toContain("export default function MediaCardBody");
    expect(body).toContain("IconShuffle");
    expect(body).toContain("IconRepeat");
    expect(body).toContain("IconPlay");
    expect(body).toContain("IconPause");
    expect(body).toContain("IconPrevious");
    expect(body).toContain("IconNext");
    expect(body).toContain("ProgressBar");
    expect(body).toContain("VolumeControl");
    expect(body).toContain("IconImage");
  });

  it("keeps the transport cluster as one row of grouped controls", () => {
    // The transport buttons are one cluster, not five unrelated glyphs. The
    // regression guard here is the shape of the row: it must still be a single
    // export of the cluster, and the shuffle/repeat toggles must still live in
    // that same cluster.
    const body = mediaCardSource();
    expect(body).toContain("TransportButtons");
    expect(body).toContain('t("common.toggle-shuffle")');
    expect(body).toContain('t("common.cycle-repeat-mode")');
    expect(body).toContain("ICON_BTN_PRIMARY");
  });

  it("keeps the wave icon as the only player glyph above the track identity", () => {
    // The empty-player fallback still reads as a quiet track-less dock, not as a
    // hard restart of the layout. `IconWave` is the one glyph the empty state
    // uses, and it should stay there while the filled path changes around it.
    const body = mediaCardSource();
    expect(body).toContain("IconWave");
  });

  it("keeps the active-regeneration counters after a full player rework", () => {
    // Operational regen counters for this card. They are not about one pixel
    // shape, they are about what the rework is allowed to lose: the file still
    // has to export the body, and the buttons that make the card a player still
    // have to exist.
    const src = mediaCardSource();
    expect(src).toContain("export default function MediaCardBody");
    expect(src).toContain("IconShuffle");
    expect(src).toContain("IconRepeat");
    expect(src).toContain("IconPlay");
    expect(src).toContain("IconPause");
    expect(src).toContain("IconPrevious");
    expect(src).toContain("IconNext");
    expect(src).toContain("ProgressBar");
    expect(src).toContain("VolumeControl");
    expect(src).toContain("IconImage");
  });
});
