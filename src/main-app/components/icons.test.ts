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

const NAMED_HARDWARE = OPENRGB_TYPES.filter(
  (t) => t !== "Virtual" && t !== "Unknown",
);

describe("deviceKind", () => {
  it.each(NAMED_HARDWARE)("resolves %s rather than falling through", (type) => {
    expect(deviceKind(type)).not.toBe("other");
  });

  it.each([
    ["Motherboard", "motherboard"],
    ["DRAM", "dram"],
    ["GPU", "gpu"],
    ["Cooler", "fan"],
    ["LEDStrip", "strip"],
    ["Keyboard", "keyboard"],
    ["Mouse", "mouse"],
    ["MouseMat", "mousemat"],
    ["Headset", "headset"],
    ["HeadsetStand", "headset"],
    ["Gamepad", "gamepad"],
    ["Light", "light"],
    ["Speaker", "speaker"],
  ] as const)("maps %s to %s", (type, expected) => {
    expect(deviceKind(type)).toBe(expected);
  });

  it("has a glyph for every kind the real icon map can be asked for", () => {
    for (const type of NAMED_HARDWARE) {
      expect(DEVICE_KINDS).toContain(deviceKind(type));
    }
  });

  it("exposes every kind as a glyph key", () => {
    expect(DEVICE_KINDS.length).toBeGreaterThan(0);
    for (const kind of DEVICE_KINDS) {
      expect(kind).toMatch(/^[a-z]+$/);
    }
  });

  it("falls back to other for a type the SDK cannot name", () => {
    expect(deviceKind("Virtual")).toBe("other");
    expect(deviceKind("Unknown")).toBe("other");
    expect(deviceKind("")).toBe("other");
  });

  it("does not mistake a mouse pad for a mouse", () => {
    expect(deviceKind("MousePad")).toBe("mousemat");
    expect(deviceKind("Mouse")).toBe("mouse");
  });
});

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
    expect(renderToStaticMarkup(createElement(IconSpinner))).toMatch(/<path d="M21 12a9 9/);
  });

  it("does not also animate on hover", () => {
    const html = renderToStaticMarkup(createElement(IconSpinner));
    expect(html).toContain("animate-spin");
    expect(html).not.toContain("transform-box:fill-box");
  });
});

describe("library icon wrapper", () => {
  it("marks every icon with the class the sizing rule keys on", () => {
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
    const html = renderToStaticMarkup(createElement(IconSearch));
    expect(html).toContain('width="18"');
  });

  it("honours an explicit size over the default", () => {
    expect(renderToStaticMarkup(createElement(IconSearch, { size: 30 }))).toContain('width="30"');
  });

  it("leaves no stray whitespace in the class when a caller passes none", () => {
    const html = renderToStaticMarkup(createElement(IconSearch));
    expect(html).not.toContain("  ");
  });
});

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
    expect(renderToStaticMarkup(createElement(IconStar))).toContain('width="18"');
  });
});



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
    expect(iconAnimates(true, true)).toBe(true);
  });
});

describe("prefersReducedMotion", () => {
  it("is false when there is no window", () => {
    expect(typeof window).toBe("undefined");
    expect(prefersReducedMotion()).toBe(false);
  });

  it("reads the media query rather than assuming an answer", () => {
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


describe("library-backed replacements", () => {
  it("fills the pin through a class, because a fill prop is discarded", () => {
    const filled = renderToStaticMarkup(createElement(IconPin, { filled: true }));
    const empty = renderToStaticMarkup(createElement(IconPin));
    expect(filled).toContain("fill-current");
    expect(empty).not.toContain("fill-current");
  });

  it("keeps the caller's class when it fills the pin", () => {
    const html = renderToStaticMarkup(
      createElement(IconPin, { filled: true, className: "h-3 w-3" }),
    );
    expect(html).toContain("h-3 w-3");
    expect(html).toContain("fill-current");
  });

  it("points the rail arrow the way the rail is going", () => {
    const closed = renderToStaticMarkup(createElement(IconRailCollapse));
    const open = renderToStaticMarkup(
      createElement(IconRailCollapse, { className: "rotate-180" }),
    );
    expect(closed).not.toBe(open);
    expect(closed).toContain("m16 15-3-3 3-3");
    expect(open).toContain("m14 9 3 3-3 3");
  });

  it("still rotates the rail arrow when asked", () => {
    const html = renderToStaticMarkup(
      createElement(IconRailCollapse, { className: "rotate-180" }),
    );
    expect(html).toContain("rotate-180");
  });

  it("marks the rail arrow so it sizes like every other icon", () => {
    expect(renderToStaticMarkup(createElement(IconRailCollapse))).toMatch(
      /class="[^"]*\bai\b/,
    );
  });
});

describe("hover wrapper", () => {
  it("wraps the icon in a contents span", () => {
    expect(renderToStaticMarkup(createElement(IconSearch))).toMatch(
      /^<span class="contents">/,
    );
  });

  it("wraps even an icon with no class of its own", () => {
    expect(renderToStaticMarkup(createElement(IconSearch))).toContain("contents");
  });

  it("marks the icon once, not twice", () => {
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

describe("hoverRootFor", () => {
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
    const entries = HOVER_ROOT.split(",").map((s) => s.trim());
    expect(entries).toContain("button");
    expect(entries).toContain('a[href]');
    expect(entries).toContain('[role="menuitem"]');
    expect(entries).toContain("label");
  });

  it("returns null when there is no such ancestor", () => {
    const { node } = nodeFinding(null);
    expect(hoverRootFor(node)).toBeNull();
  });

  it("survives having no node at all", () => {
    expect(hoverRootFor(null)).toBeNull();
  });

  it("does not invent a root from a falsy match", () => {
    const { node } = nodeFinding(undefined);
    expect(hoverRootFor(node)).toBeNull();
  });
});

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
    expect(ANIMATED_DEVICE_KINDS).not.toContain("motherboard");
    expect(ANIMATED_DEVICE_KINDS).not.toContain("fan");
  });

  it("covers every kind across both maps, so none falls to the generic box", () => {
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
    expect(renderDevice("Keyboard")).toMatch(/class="[^"]*\bai\b[^"]*h-4 w-4/);
  });

  it("keeps the caller's size class on animated kinds", () => {
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
