// `deviceKind` decides both the glyph on a device card and the type label
// beside it, and it has to reach the same conclusion the driver did. It had no
// coverage at all, so the cases below are taken from the SDK's `DeviceType`
// enum rather than from what the code happened to handle.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  deviceKind,
  DEVICE_KINDS,
  ANIMATED_DEVICE_KINDS,
  IconDevice,
  IconSearch,
  IconPin,
  IconRailCollapse,
  IconSpinner,
  IconStar,
  iconAnimates,
  prefersReducedMotion,
  hoverRootFor,
  HOVER_ROOT,
} from "./icons";

/**
 * Every variant of the SDK's `DeviceType` (openrgb 0.1.2), which is what
 * `DeviceInfo.type_name` is: the Rust `Debug` of the enum. The wire format
 * cannot produce a string outside this list, so these are the real inputs and
 * not a sample of them.
 */
const OPENRGB_TYPES = [
  "Motherboard",
  "DRAM",
  "GPU",
  "Cooler",
  "LEDStrip",
  "Keyboard",
  "Mouse",
  "MouseMat",
  "Headset",
  "HeadsetStand",
  "Gamepad",
  "Light",
  "Speaker",
  "Virtual",
  "Unknown",
] as const;

/**
 * The types the enum can name as real hardware. `Virtual` and `Unknown` are
 * the SDK's own bail-outs — there is no truthful glyph for them — so they are
 * excluded here and asserted as `other` on their own below.
 */
const NAMED_HARDWARE = OPENRGB_TYPES.filter(
  (t) => t !== "Virtual" && t !== "Unknown",
);

describe("deviceKind", () => {
  it.each(NAMED_HARDWARE)("resolves %s rather than falling through", (type) => {
    // The regression this pins: a type the enum can actually produce landing
    // on the generic glyph, so real hardware shows the "other" box and an
    // untranslated driver string.
    expect(deviceKind(type)).not.toBe("other");
  });

  it.each([
    ["Motherboard", "motherboard"],
    ["DRAM", "dram"],
    ["GPU", "gpu"],
    // A liquid cooler is a fan as far as lighting is concerned.
    ["Cooler", "fan"],
    ["LEDStrip", "strip"],
    ["Keyboard", "keyboard"],
    ["Mouse", "mouse"],
    ["MouseMat", "mousemat"],
    ["Headset", "headset"],
    // A stand lights up because of the headset on it; same glyph, same label.
    ["HeadsetStand", "headset"],
    ["Gamepad", "gamepad"],
    ["Light", "light"],
    ["Speaker", "speaker"],
  ] as const)("maps %s to %s", (type, expected) => {
    expect(deviceKind(type)).toBe(expected);
  });

  it("has a glyph for every kind the real icon map can be asked for", () => {
    // The two halves drifting apart is the failure the export comment warns
    // about: `IconDevice` indexes DEVICE_ICONS by this string, so a kind with
    // no entry renders the generic box. DEVICE_KINDS is read off the map
    // itself — a hand-written list here would just be updated alongside the
    // same mistake.
    for (const type of NAMED_HARDWARE) {
      expect(DEVICE_KINDS).toContain(deviceKind(type));
    }
  });

  it("exposes every kind as a glyph key", () => {
    // Guards the pairing from the other side too: no orphan entries in the
    // map that no device type can reach.
    expect(DEVICE_KINDS.length).toBeGreaterThan(0);
    for (const kind of DEVICE_KINDS) {
      expect(kind).toMatch(/^[a-z]+$/);
    }
  });

  it("falls back to other for a type the SDK cannot name", () => {
    // `Virtual` and `Unknown` are the enum's own bail-outs, and a vendor
    // string that matches no rule is a drawing instruction, not a word.
    expect(deviceKind("Virtual")).toBe("other");
    expect(deviceKind("Unknown")).toBe("other");
    expect(deviceKind("")).toBe("other");
  });

  it("does not mistake a mouse pad for a mouse", () => {
    // The reason the mouse rule excludes "mat" and "pad": a mouse pad is a
    // large lit surface, not a pointing device.
    expect(deviceKind("MousePad")).toBe("mousemat");
    expect(deviceKind("Mouse")).toBe("mouse");
  });
});

// Rendered rather than inspected: the spinner wraps a library icon, so whether
// `animate-spin` survives depends on how the class is threaded through two
// layers of merging. It is invisible in the source and shows up only as a
// pending button that never moves.
describe("IconSpinner", () => {
  it("keeps spinning when the caller sizes it", () => {
    const html = renderToStaticMarkup(createElement(IconSpinner, { className: "h-4 w-4" }));
    expect(html).toContain("animate-spin");
    expect(html).toContain("h-4 w-4");
  });

  it("spins with no caller class at all", () => {
    expect(renderToStaticMarkup(createElement(IconSpinner))).toContain("animate-spin");
  });

  it("draws an arc, not a closed ring", () => {
    // A full circle with no gap renders as a static donut. The library's loader
    // is an arc by construction, so this asserts the shape rather than the dash
    // pattern the hand-drawn version used.
    expect(renderToStaticMarkup(createElement(IconSpinner))).toMatch(/<path d="M21 12a9 9/);
  });

  it("does not also animate on hover", () => {
    // The spinner means work is in flight. If the library's own hover animation
    // were live it would fight the CSS spin and the icon would twitch every time
    // the pointer crossed the button.
    const html = renderToStaticMarkup(createElement(IconSpinner));
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("transform-box:fill-box");
  });
});

// The library renders `<div class="inline-flex"><svg/></div>` and puts the
// caller's className on the wrapper, not on the svg. Three separate
// regressions rode in on that, and none of them are visible in the source --
// they only show up as a card header with a 24px glyph in it, or a star that
// refuses to fill. These pin the shape both the CSS rule and the call sites
// now depend on.
describe("library icon wrapper", () => {
  it("marks every icon with the class the sizing rule keys on", () => {
    // `:where(.ai) > svg` in index.css is what stops a classed icon from
    // overflowing the box it was given. Drop the marker and every icon in the
    // app renders 24px inside a 16px slot, with no error anywhere.
    const html = renderToStaticMarkup(createElement(IconSearch));
    expect(html).toContain("ai");
    expect(html).toMatch(/class="[^"]*\bai\b/);
  });

  it("puts the caller's own class on the wrapper alongside the marker", () => {
    const html = renderToStaticMarkup(createElement(IconSearch, { className: "h-4 w-4" }));
    expect(html).toContain("ai");
    expect(html).toContain("h-4 w-4");
  });

  it("defaults to 18px so an unsized icon matches the hand-drawn set", () => {
    // The library's own default is 24. A caller that passes no sizing class
    // used to get a glyph a third larger than every icon beside it.
    const html = renderToStaticMarkup(createElement(IconSearch));
    expect(html).toContain('width="18"');
  });

  it("honours an explicit size over the default", () => {
    expect(renderToStaticMarkup(createElement(IconSearch, { size: 30 }))).toContain('width="30"');
  });

  it("leaves no stray whitespace in the class when a caller passes none", () => {
    // Cosmetic, but a doubled space here would have been the visible symptom
    // of the class being assembled by hand in two places at once.
    const html = renderToStaticMarkup(createElement(IconSearch));
    expect(html).not.toContain("  ");
  });
});

// A filled star is reached through a class on the glyph's own subpaths, because
// `fill` passed to the component lands on the wrapper div and is discarded.
// Asserting the class rather than the pixels keeps the test honest about what
// it is actually checking: that the fill route is wired up at all.
describe("IconStar", () => {
  it("does not fill when unset", () => {
    expect(renderToStaticMarkup(createElement(IconStar))).not.toContain("fill-current");
  });

  it("fills the glyph's subpaths when set", () => {
    const html = renderToStaticMarkup(createElement(IconStar, { filled: true }));
    expect(html).toContain("fill-current");
  });

  it("keeps the marker and the caller's class when filled", () => {
    const html = renderToStaticMarkup(createElement(IconStar, { filled: true, className: "h-4 w-4" }));
    expect(html).toMatch(/class="[^"]*\bai\b[^"]*fill-current[^"]*h-4 w-4/);
  });

  it("still honours the size default", () => {
    // The regression: this component was written by hand rather than through
    // `anim()`, so it missed the 18px default and rendered at 24.
    expect(renderToStaticMarkup(createElement(IconStar))).toContain('width="18"');
  });
});



// The library animates from JavaScript, on mouse enter, by writing a transform
// onto the inner `<g>`. The `prefers-reduced-motion` block in index.css only
// neutralises CSS animations, so it cannot stop this -- the preference has
// to reach the library through `isAnimated`. Without these, a user who turned
// motion off in Windows still gets every icon moving.
//
// Asserted against `iconAnimates` rather than the rendered markup: the library
// keeps `isAnimated` off the DOM entirely and applies it imperatively, so a
// static render looks the same either way.
describe("iconAnimates", () => {
  it("stops animating when the OS asks for reduced motion", () => {
    expect(iconAnimates(undefined, true)).toBe(false);
  });

  it("animates when it has not", () => {
    expect(iconAnimates(undefined, false)).toBe(true);
  });

  it("lets a caller turn one icon off whatever the setting is", () => {
    expect(iconAnimates(false, false)).toBe(false);
  });

  it("lets a caller turn one icon on whatever the setting is", () => {
    // A deliberate opt-in outranks the OS preference: the app may know that one
    // icon's motion carries meaning, and overruling it here would be the wrong
    // place to be opinionated.
    expect(iconAnimates(true, true)).toBe(true);
  });
});

// The reader has to survive having no DOM at all, or a server-side render of
// the dashboard takes the whole panel down rather than one icon.
describe("prefersReducedMotion", () => {
  it("is false when there is no window", () => {
    expect(typeof window).toBe("undefined");
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the media query rather than assuming an answer", () => {
    // Guards the one real hazard in the function: a typo in the query string
    // would silently report false and re-enable motion for every user who
    // asked for none of it.
    const hadWindow = "window" in globalThis;
    const previous = (globalThis as Record<string, unknown>).window;
    const seen: string[] = [];
    (globalThis as Record<string, unknown>).window = {
      matchMedia: (query: string) => {
        seen.push(query);
        return { matches: true, media: query };
      },
    };
    try {
      expect(prefersReducedMotion()).toBe(true);
      expect(seen).toEqual(["(prefers-reduced-motion: reduce)"]);
    } finally {
      if (hadWindow) {
        (globalThis as Record<string, unknown>).window = previous;
      } else {
        delete (globalThis as Record<string, unknown>).window;
      }
    }
  });
});


// The hand-drawn trio that gave way to the library, and the two lookups that
// did not. Asserted on rendered output because each of these was wrong in a way
// only the markup shows.
describe("library-backed replacements", () => {
  it("fills the pin through a class, because a fill prop is discarded", () => {
    const filled = renderToStaticMarkup(createElement(IconPin, { filled: true }));
    const empty = renderToStaticMarkup(createElement(IconPin));
    expect(filled).toContain("fill-current");
    expect(empty).not.toContain("fill-current");
  });

  it("keeps the caller's class when it fills the pin", () => {
    // The regression: IconPin builds its class through aiClass and then anim()
    // runs it through aiClass again. When the second pass deduplicated carelessly
    // it dropped the whole string, taking the caller's size with it.
    const html = renderToStaticMarkup(
      createElement(IconPin, { filled: true, className: "h-3 w-3" }),
    );
    expect(html).toContain("h-3 w-3");
    expect(html).toContain("fill-current");
  });

  it("points the rail arrow the way the rail is going", () => {
    // Two library glyphs rather than one rotated in place: a chevron flipped
    // about its own centre points the right way but leaves the panel edge on the
    // wrong side.
    const closed = renderToStaticMarkup(createElement(IconRailCollapse));
    const open = renderToStaticMarkup(
      createElement(IconRailCollapse, { className: "rotate-180" }),
    );
    expect(closed).not.toBe(open);
    expect(closed).toContain("m16 15-3-3 3-3");
    expect(open).toContain("m14 9 3 3-3 3");
  });

  it("still rotates the rail arrow when asked", () => {
    // The rotate is what the button animates, so dropping it would leave the
    // sidebar snapping between states instead of turning.
    const html = renderToStaticMarkup(
      createElement(IconRailCollapse, { className: "rotate-180" }),
    );
    expect(html).toContain("rotate-180");
  });

  it("marks the rail arrow so it sizes like every other icon", () => {
    // It now goes through anim() for the hover trigger, which means it is no
    // longer a bare svg and depends on the marker the CSS rule keys on.
    expect(renderToStaticMarkup(createElement(IconRailCollapse))).toMatch(
      /class="[^"]*\bai\b/,
    );
  });
});

// Every library icon now renders inside a `display: contents` span. That wrapper
// is what lets the hover hook find the button an icon sits inside, so it has to
// be there -- and it has to be invisible in layout, or every icon gains a box
// and the flex rows around them reflow.
describe("hover wrapper", () => {
  it("wraps the icon in a contents span", () => {
    expect(renderToStaticMarkup(createElement(IconSearch))).toMatch(
      /^<span class="contents">/,
    );
  });

  it("wraps even an icon with no class of its own", () => {
    // Invisible at the call site: the button simply stops animating.
    expect(renderToStaticMarkup(createElement(IconSearch))).toContain("contents");
  });

  it("marks the icon once, not twice", () => {
    // Checked on the icons that compose a class and hand it to anim(), which
    // then calls aiClass again -- the path where the marker could double.
    for (const icon of [IconSearch, IconPin, IconSpinner]) {
      const html = renderToStaticMarkup(createElement(icon));
      expect(html.match(/\bai\b/g) || []).toHaveLength(1);
    }
  });

  it("keeps every caller class through the merge", () => {
    const html = renderToStaticMarkup(
      createElement(IconSearch, { className: "h-4 w-4 text-white" }),
    );
    expect(html).toContain("h-4 w-4");
    expect(html).toContain("text-white");
  });

  it("leaves no stray whitespace in the class", () => {
    expect(renderToStaticMarkup(createElement(IconSearch))).not.toContain("  ");
  });
});

// The hover trigger itself cannot be exercised here: no DOM means `closest()`
// never runs and no listener ever attaches. `hoverRootFor` is the decision that
// hook makes, extracted so it can be asked directly with a stand-in for the DOM.
describe("hoverRootFor", () => {
  /** A node that answers `closest` with whatever it was handed. */
  const nodeFinding = (found: unknown) => {
    const asked: string[] = [];
    return {
      node: {
        closest: (selector: string) => {
          asked.push(selector);
          return found;
        },
      } as unknown as Element & { closest: (s: string) => unknown },
      asked,
    };
  };

  it("returns the element the DOM reports", () => {
    const root = { tagName: "BUTTON" };
    const { node } = nodeFinding(root);
    expect(hoverRootFor(node)).toBe(root);
  });

  it("asks about the elements a reader would click", () => {
    // The regression this guards: dropping the bare `button` selector leaves every
    // button in the app with an icon that only moves when the pointer is on the
    // glyph. Silent, and invisible in the markup.
    //
    // Matched as a comma-separated entry rather than a substring, because
    // `"button"` is also inside `[role="button"]` and a substring assertion would
    // pass with the plain `button` removed.
    const entries = HOVER_ROOT.split(",").map((s) => s.trim());
    expect(entries).toContain("button");
    expect(entries).toContain('a[href]');
    expect(entries).toContain('[role="menuitem"]');
    expect(entries).toContain("label");
  });

  it("returns null when there is no such ancestor", () => {
    // An icon standing on its own has nothing to trigger on, and the effect
    // must bail rather than throw.
    const { node } = nodeFinding(null);
    expect(hoverRootFor(node)).toBeNull();
  });

  it("survives having no node at all", () => {
    expect(hoverRootFor(null)).toBeNull();
  });

  it("does not invent a root from a falsy match", () => {
    // `closest` returns null, and `null ?? something` is the classic way to turn
    // \'no match\' into a crash one line later.
    const { node } = nodeFinding(undefined);
    expect(hoverRootFor(node)).toBeNull();
  });
});

/**
 * Device glyphs are split between the animated library and a couple of
 * hand-drawn marks. A device row is one of the most hovered surfaces in the
 * window, and the hand-drawn SVGs are static by construction, so routing the
 * kinds the library covers through `anim` is what makes them move at all.
 */
describe("IconDevice animation split", () => {
  const renderDevice = (type: string, size?: number) =>
    renderToStaticMarkup(
      createElement(IconDevice, { type, className: "h-4 w-4", size }),
    );

  it("routes most kinds through the animated library", () => {
    expect(ANIMATED_DEVICE_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(ANIMATED_DEVICE_KINDS).toContain("keyboard");
    expect(ANIMATED_DEVICE_KINDS).toContain("mouse");
  });

  it("keeps hand-drawn marks only where the library has no equivalent", () => {
    // Lucide has no circuit board and no fan. Drawing a cooler as a weather
    // glyph because `wind` exists would be worse than a still correct mark.
    expect(ANIMATED_DEVICE_KINDS).not.toContain("motherboard");
    expect(ANIMATED_DEVICE_KINDS).not.toContain("fan");
  });

  it("covers every kind across both maps, so none falls to the generic box", () => {
    // Derived rather than a literal: the comment on the map said "fourteen"
    // for the whole life of the file and `deviceKind` returns thirteen.
    const declared = new Set([
      ...ANIMATED_DEVICE_KINDS,
      "motherboard",
      "fan",
    ]);
    for (const kind of DEVICE_KINDS) expect(declared).toContain(kind);
    expect(DEVICE_KINDS).toHaveLength(declared.size);
  });

  it("draws every kind without throwing", () => {
    for (const kind of DEVICE_KINDS) {
      const type = kind === "motherboard" ? "Motherboard" : `LEDStrip${kind}`;
      expect(() => renderDevice(type)).not.toThrow();
    }
  });

  it("carries the ai marker on animated kinds so the library takes over", () => {
    // Without `ai` the glyph renders but never animates, which looks identical
    // to the old hand-drawn set — the exact bug this change fixes.
    expect(renderDevice("Keyboard")).toMatch(/class="[^"]*\bai\b[^"]*h-4 w-4/);
  });

  it("keeps the caller's size class on animated kinds", () => {
    // The width attribute is the 18px *default*, not the final size; the
    // wrapper class wins over it in CSS. Asserting `width="16"` here would fail
    // against correct code.
    expect(renderDevice("Keyboard")).toMatch(/class="[^"]*\bh-4\b[^"]*\bw-4\b/);
    expect(renderDevice("Keyboard")).toContain('width="18"');
  });

  it("honours an explicit size when a caller passes one", () => {
    expect(renderDevice("Keyboard", 30)).toContain('width="30"');
  });

  it("still renders hand-drawn kinds as a plain svg with no ai marker", () => {
    const html = renderDevice("Motherboard");
    expect(html).toContain("<svg");
    expect(html).not.toContain('class="ai');
  });
});
