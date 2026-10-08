import { describe, expect, it } from "vitest";

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

function wallpaperStage(src: string): string {
  const start = src.indexOf("function WallpaperStage");
  const end = src.indexOf("function EqBars");
  if (start < 0 || end < 0 || end < start) {
    throw new Error("could not bound the wallpaper stage");
  }
  return src.slice(start, end);
}

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
    const section = nowPlayingSection(mediaCardSource());
    expect(section).not.toMatch(/\btitle=\{t\(/);
    expect(section).not.toMatch(/\btitle=\{media\./);
    expect(section).not.toMatch(/\btitle=\{`/);
    expect(section).not.toMatch(/\btitle=\{wallpaperName\}/);
  });

  it("still carries the wallpaper name as a tooltip on its glyph", () => {
    expect(wallpaperStage(mediaCardSource())).toContain(
      "data-tip={wallpaperName}",
    );
  });

  it("keeps an accessible name on every overlay control", () => {
    const src = nowPlayingSection(mediaCardSource());
    expect(src).toContain('aria-label={t("common.change-wallpaper")}');
    expect(src).toContain('data-tip={t("common.change-wallpaper")}');
    expect(src).toContain(
      'aria-label={t(muted ? "common.unmute" : "common.mute")}',
    );
    expect(src).toContain('aria-label={t("common.system-volume")}');
  });

  it("marks the countdown toggle as a control at rest, not only on hover", () => {
    const src = nowPlayingSection(mediaCardSource());
    const start = src.lastIndexOf("<button", src.indexOf("common.toggle-remaining-time"));
    const toggle = src.slice(start, src.indexOf("</button>", start));
    expect(toggle).toContain("underline underline-offset-2");
    expect(toggle).toContain("focus-glow");
    expect(toggle).toContain("text-[rgb(var(--glow))]");
    expect(toggle).toContain("text-[var(--text-faint)]");
  });

  it("reveals the wallpaper identity rail on hover and on focus-within", () => {
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toContain("data-tip={wallpaperName}");
    expect(stage).toContain("group-hover:opacity-100");
    expect(stage).toContain("group-focus-within:opacity-100");
    expect(stage).toMatch(/opacity-0/);
  });

  it("keeps the picture clear of hidden labels at rest except the identity rail", () => {
    const stage = wallpaperStage(mediaCardSource());

    expect(stage).toContain('{t("common.paused")}');

    expect(stage).not.toContain("top-full");
    expect(stage).toContain("bottom-full");

    expect(stage).toMatch(/opacity-0/);

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

    expect(frostedDock).toHaveLength(1);
    expect(rail).toBeDefined();

    expect(FROST.test(rail!)).toBe(false);
    expect(BLUR.test(rail!)).toBe(false);
    expect(WASH.test(rail!)).toBe(false);
    const dock = frostedDock[0]!;
    expect(dock).not.toBe(rail);

    const railIdx = stage.indexOf(`className="${rail}"`);
    expect(railIdx).toBeGreaterThan(-1);
    const railMarkup = stage.slice(
      railIdx,
      stage.indexOf("absolute inset-x-0 bottom-0"),
    );
    expect(railMarkup).toContain("data-tip={wallpaperName}");
    expect(railMarkup).toMatch(/opacity-0/);
    expect(railMarkup).not.toMatch(/>\s*\{wallpaperName\}/);
    expect(railMarkup).not.toMatch(/linear-gradient/);
    expect(dock).not.toMatch(/opacity-0/);
  });

  it("bleeds into the card it lives in instead of drawing a second one", () => {
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).not.toMatch(/border border-\[/);
    expect(stage).toContain("-m-4");
    expect(stage).toContain("rounded-b-[var(--radius-xl)]");
  });

  it("keeps the wallpaper name off the picture", () => {
    expect(wallpaperStage(mediaCardSource())).not.toMatch(
      />\s*\{wallpaperName\}/,
    );
  });

  it("keeps the name a label rather than a fake control", () => {
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).toMatch(
      /data-tip=\{wallpaperName\}[\s\S]{0,200}?<\/span>/,
    );
    expect(stage).not.toMatch(
      /<button[^>]*onClick=\{onChange\}[^>]*data-tip=\{wallpaperName\}/,
    );
  });

  it("says when the wallpaper is paused, rather than only going still", () => {
    expect(wallpaperStage(mediaCardSource())).toContain('{t("common.paused")}');
  });

  it("keeps the section title in the tab header, not inside the stage", () => {
    const stage = wallpaperStage(mediaCardSource());
    expect(stage).not.toContain('overview.now-playing');
    expect(stage).not.toContain('overview.paused-track');
  });

  it("keeps the player as one dock instead of splitting it into several panels", () => {
    const body = mediaCardSource();
    expect(body).toContain("absolute inset-x-0 bottom-0");
    expect(body).toContain("track-swap");
    expect(body).toContain('aria-label={t("common.system-volume")}');
    expect(body).toContain("-mx-3 -mb-1 mt-2");
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
    const body = mediaCardSource();
    expect(body).toContain("TransportButtons");
    expect(body).toContain('t("common.toggle-shuffle")');
    expect(body).toContain('t("common.cycle-repeat-mode")');
    expect(body).toContain("ICON_BTN_PRIMARY");
  });

  it("keeps the wave icon as the only player glyph above the track identity", () => {
    const body = mediaCardSource();
    expect(body).toContain("IconWave");
  });

  it("keeps the active-regeneration counters after a full player rework", () => {
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
