import { describe, expect, it } from "vitest";
import { filterRail, foldForSearch, type RailItem } from "./railFilter";

// Built the way `SettingsLayout` builds them: resolved strings, folded. The
// Spanish blurb is deliberately accented because that is the case the folding
// exists for.
const row = (id: string, label: string, blurb: string): RailItem => ({
  id,
  text: foldForSearch(`${label} ${blurb}`),
});

const RAIL: RailItem[] = [
  row("appearance", "Appearance", "Theme, accent and lock screen"),
  row("startup", "Startup & power", "Autostart, tray behaviour, pausing"),
  row("hotkeys", "Global hotkeys", "System-wide key bindings"),
  row("displays", "Displays", "Per-monitor wallpaper"),
  row("developer", "Developer", "Build details, configuration and logs"),
  row("about", "About & updates", "Versión, notas de la versión y guía"),
];

/**
 * Matching with the active-row rule switched out.
 *
 * An empty active id isolates the two behaviours: these assertions are about
 * what matches the query, and retention has its own tests below. Passing a real
 * section id here would quietly add that row to every expected array.
 */
const NO_ACTIVE = "";

const ids = (items: readonly RailItem[]) => items.map((i) => i.id);

describe("foldForSearch", () => {
  it("drops case", () => {
    expect(foldForSearch("Global Hotkeys")).toBe("global hotkeys");
  });

  it("strips accents so typing without them still finds accented labels", () => {
    // The regression this exists for: a Spanish user types "video" and
    // "Vídeo" has to come back.
    expect(foldForSearch("Vídeo")).toBe("video");
    expect(foldForSearch("Configuración")).toBe("configuracion");
  });

  it("folds both sides to the same form", () => {
    expect(foldForSearch("Añadir")).toBe(foldForSearch("anadir"));
  });

  it("leaves text without accents untouched", () => {
    expect(foldForSearch("Displays")).toBe("displays");
  });
});

describe("filterRail", () => {
  it("returns everything for an empty query", () => {
    for (const q of ["", "   ", "\t\n"]) {
      expect(filterRail(RAIL, q, "appearance")).toBe(RAIL);
    }
  });

  it("matches a single token anywhere in the row", () => {
    expect(ids(filterRail(RAIL, "hotkey", NO_ACTIVE))).toEqual(["hotkeys"]);
    // Found in the blurb, not the label — which is why the blurb is searchable.
    expect(ids(filterRail(RAIL, "tray", NO_ACTIVE))).toEqual(["startup"]);
  });

  it("requires every token, so a phrase typed as words still finds the row", () => {
    expect(ids(filterRail(RAIL, "global bindings", NO_ACTIVE))).toEqual([
      "hotkeys",
    ]);
    // One token present, one absent: not a match.
    expect(ids(filterRail(RAIL, "global wallpaper", NO_ACTIVE))).toEqual([]);
  });

  it("matches regardless of case and accents in the query", () => {
    expect(ids(filterRail(RAIL, "HOTKEY", NO_ACTIVE))).toEqual(["hotkeys"]);
    // Found through the Spanish blurb, which carries accents.
    expect(ids(filterRail(RAIL, "version", NO_ACTIVE))).toEqual(["about"]);
  });

  it("keeps the section being read, even when it does not match", () => {
    // The rail tracks scroll position. Dropping the highlighted row would leave
    // someone reading a section with nothing lit up and no sense of place.
    expect(ids(filterRail(RAIL, "hotkey", "displays"))).toEqual([
      "hotkeys",
      "displays",
    ]);
  });

  it("keeps rail order, so a retained row does not jump to the top", () => {
    // The retained row is filtered in place rather than prepended: a row that
    // moves when you type is a row you lose track of.
    const out = filterRail(RAIL, "zzz", "about");
    expect(ids(out)).toEqual(["about"]);
    expect(ids(filterRail(RAIL, "zzz", "developer"))).toEqual(["developer"]);
  });

  it("adds only the active row to the matches, never the whole rail", () => {
    // ...and every other row still has to earn its place.
    expect(ids(filterRail(RAIL, "hotkey", "startup"))).toEqual([
      "startup",
      "hotkeys",
    ]);
  });

  it("does not duplicate the active row when it also matches", () => {
    expect(ids(filterRail(RAIL, "hotkey", "hotkeys"))).toEqual(["hotkeys"]);
  });

  it("returns nothing when nothing matches and nothing is active", () => {
    expect(filterRail(RAIL, "zzzz", "")).toEqual([]);
  });

  it("survives an empty rail", () => {
    expect(filterRail([], "hotkey", "about")).toEqual([]);
    expect(filterRail([], "", "about")).toEqual([]);
  });

  it("does not mutate the input", () => {
    const before = RAIL.map((i) => i.id);
    filterRail(RAIL, "hotkey", "about");
    expect(RAIL.map((i) => i.id)).toEqual(before);
  });
});