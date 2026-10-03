import { describe, it, expect } from "vitest";
import {
  profileMatches,
  sceneMatches,
  activeConfigName,
  activeConfigId,
  type ProfileTarget,
  type SceneTarget,
} from "./profileMatch";
import type { SceneProfile, StickerDef } from "@shared/types";

const target: ProfileTarget = {
  mode: "ambient",
  staticColor: [255, 128, 0],
  animationSpeed: 1,
};

const lighting = (over: Partial<ProfileTarget> = {}): ProfileTarget => ({
  mode: "ambient",
  staticColor: [255, 128, 0],
  animationSpeed: 1,
  ...over,
});

describe("profileMatches", () => {
  it("matches lighting that is exactly what is applied", () => {
    expect(profileMatches(lighting(), target)).toBe(true);
  });

  it("does not match when the mode differs", () => {
    expect(profileMatches(lighting({ mode: "wave" }), target)).toBe(false);
  });

  it("does not match when the colour differs", () => {
    // One channel is enough: the lighting is applied as a whole, so a partial
    // match would call a config current while its colour is not on screen.
    expect(
      profileMatches(lighting({ staticColor: [255, 128, 1] }), target),
    ).toBe(false);
  });

  it("does not match when the speed differs beyond the tolerance", () => {
    expect(profileMatches(lighting({ animationSpeed: 1.5 }), target)).toBe(false);
  });

  it("survives a JSON round-trip that perturbs the speed", () => {
    // The real case this exists for: 1.4 written to the config can read back
    // as 1.4000000000000001. An exact comparison would report every saved
    // config as inactive after a restart, which looks like data loss.
    const stored = JSON.parse(JSON.stringify(lighting({ animationSpeed: 1.4 })));
    expect(
      profileMatches(stored, { ...target, animationSpeed: 1.4 }),
    ).toBe(true);
  });

  it("still rejects a speed genuinely above the tolerance after a round trip", () => {
    // The tolerance must not become a blanket "close enough": 1.4 against 1.5
    // is a real difference and calling that config current would be a lie.
    expect(
      profileMatches(
        JSON.parse(JSON.stringify(lighting({ animationSpeed: 1.4 }))),
        { ...target, animationSpeed: 1.5 },
      ),
    ).toBe(false);
  });
});
// ===== whole-config matching =====
//
// A saved config captures the wallpaper, the lighting and the stickers, so
// "which config is running" is the same question as the lighting one with two
// more answers to get right. What a user notices when this is wrong is the chip
// naming a config they are not in.

const sticker = (over: Partial<StickerDef> = {}): StickerDef => ({
  id: "st1",
  name: "cat",
  url: "media://cat.png",
  x: 100,
  y: 200,
  w: 300,
  h: 300,
  rotation: 0,
  opacity: 1,
  fit: "contain",
  muted: false,
  visible: true,
  onTop: false,
  ...over,
});

const sceneWallpaper = {
  kind: "video",
  source: "media://a.mp4",
} as SceneProfile["wallpaper"];
const sceneRgb = {
  mode: "ambient",
  staticColor: [255, 128, 0],
  animationSpeed: 1,
} as SceneProfile["rgb"];

/**
 * A scene fixture holding what the comparison reads, defaulted to the state
 * `applied` describes.
 *
 * The casts sit at the fixture boundary, never inside an assertion: spelling
 * out every field of `WallpaperConfig` and `RgbConfig` would bury four
 * assertions about kind, source, lighting and stickers in twenty lines of
 * fields none of them touch. They are also why the defaults above have to be
 * complete -- a partial fixture that omits `wallpaper` reads as undefined at
 * runtime and takes the comparison down with it.
 */
const scene = (over: Partial<SceneProfile> = {}): SceneProfile =>
  ({
    id: "s1",
    name: "Evening",
    wallpaper: sceneWallpaper,
    rgb: sceneRgb,
    stickers: [sticker()],
    createdMs: 0,
    ...over,
  } as SceneProfile);

const applied: SceneTarget = {
  wallpaper: { kind: "video", source: "media://a.mp4" },
  rgb: target,
  stickers: [sticker()],
};

describe("sceneMatches", () => {
  it("matches the config the machine is running", () => {
    expect(sceneMatches(scene(), applied)).toBe(true);
  });

  it("does not match when the wallpaper kind differs", () => {
    // Same file, different kind: an image and a video of the same path are not
    // the same desktop, so the config is not the one being run.
    expect(
      sceneMatches(
        scene({
          wallpaper: { kind: "image", source: "media://a.mp4" } as SceneProfile["wallpaper"],
        }),
        applied,
      ),
    ).toBe(false);
  });

  it("does not match when only the wallpaper source differs", () => {
    expect(
      sceneMatches(
        scene({
          wallpaper: { kind: "video", source: "media://b.mp4" } as SceneProfile["wallpaper"],
        }),
        applied,
      ),
    ).toBe(false);
  });

  it("does not match when the lighting differs", () => {
    // The config is whole: matching wallpaper and stickers with the lights on
    // something else is still not this config.
    expect(
      sceneMatches(
        scene({
          rgb: { mode: "wave", staticColor: [255, 128, 0], animationSpeed: 1 } as SceneProfile["rgb"],
        }),
        applied,
      ),
    ).toBe(false);
  });

  it("does not match when a sticker moved", () => {
    expect(
      sceneMatches(scene({ stickers: [sticker({ x: 101 })] }), applied),
    ).toBe(false);
  });

  it("does not match when a sticker was added to the desk", () => {
    // The length check is what catches this, and it has to run before the
    // element-wise compare or the extra sticker is simply never looked at.
    expect(
      sceneMatches(scene(), {
        ...applied,
        stickers: [sticker(), sticker({ id: "st2", name: "dog", x: 900 })],
      }),
    ).toBe(false);
  });

  it("matches a config saved before stickers were captured against a clear desk", () => {
    // Every scene written before this feature has an empty sticker list, so
    // this is the migration case: recalling it must not read as a mismatch
    // against a desk the user has since cleared.
    expect(
      sceneMatches(scene({ stickers: [] }), { ...applied, stickers: [] }),
    ).toBe(true);
  });
});

describe("activeConfigName", () => {
  const evening = scene();

  it("names the config the machine is running", () => {
    expect(activeConfigName([evening], applied)).toBe("Evening");
  });

  it("returns null when the machine is on something no config describes", () => {
    expect(
      activeConfigName(
        [
          scene({
            name: "Other",
            wallpaper: { kind: "image", source: "media://b.png" } as SceneProfile["wallpaper"],
          }),
        ],
        applied,
      ),
    ).toBeNull();
  });

  it("returns null when there are no configs at all", () => {
    // A fresh install has none, and the chip must not name one.
    expect(activeConfigName([], applied)).toBeNull();
    expect(activeConfigName(undefined, applied)).toBeNull();
  });

  it("picks the first match in stored order when two describe the same state", () => {
    const duplicate = scene({ id: "s2", name: "Copy" });
    expect(activeConfigName([evening, duplicate], applied)).toBe("Evening");
  });
});

describe("activeConfigId", () => {
  const evening = scene({ id: "s1", name: "Evening" });

  it("names the config the machine is running by id", () => {
    expect(activeConfigId([evening], applied)).toBe("s1");
  });

  it("returns null when nothing is running that is saved", () => {
    expect(activeConfigId([], applied)).toBeNull();
    expect(activeConfigId(undefined, applied)).toBeNull();
  });

  it("picks the right one when two configs share a name", () => {
    // The picker marks the current row by id. Marking by name would light up
    // both, and clicking the wrong one is a silent switch to another setup --
    // which is why the duplicate check exists and why this cannot rely on it.
    const lookalike = scene({
      id: "s2",
      name: evening.name,
      wallpaper: { kind: "image", source: "media://b.png" } as SceneProfile["wallpaper"],
    });
    expect(activeConfigId([lookalike, evening], applied)).toBe("s1");
  });

  it("agrees with the name lookup on the same state", () => {
    // Two lookups, one comparison: a picker that disagrees with the chip above
    // it about which config is running is worse than either being absent.
    const pair = [scene({ id: "s2", name: "Work" }), evening];
    const id = activeConfigId(pair, applied);
    expect(pair.find((s) => s.id === id)?.name).toBe(activeConfigName(pair, applied));
  });
});
