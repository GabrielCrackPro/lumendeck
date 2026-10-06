import { describe, expect, it } from "vitest";
import { matchRanges, matchTerm, parseQuery, scoreCommand, withPinnedRecents } from "./paletteScore";

describe("matchTerm tiers", () => {
  // The contract: exact > prefix > word start > substring > subsequence, and
  // nothing done inside a tier may cross into another. These five strings all
  // contain "wave"; only the way they contain it differs.
  it("ranks where a match sits, not just that it sits", () => {
    const exact = matchTerm("wave", "wave").score;
    const prefix = matchTerm("wave", "waveform").score;
    const wordStart = matchTerm("wave", "my wave").score;
    const substring = matchTerm("wave", "soundwave").score;
    const subsequence = matchTerm("wave", "wastehaven").score;

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it("prefers the shorter target inside a tier", () => {
    expect(matchTerm("wave", "wave").score).toBeGreaterThan(
      matchTerm("wave", "waveform").score,
    );
  });

  it("ignores case in both directions", () => {
    expect(matchTerm("WAVE", "waveform").score).toBe(matchTerm("wave", "Waveform").score);
  });

  it("returns zero, and nothing to highlight, when the text lacks the term", () => {
    expect(matchTerm("wave", "quiet")).toEqual({ score: 0, ranges: [] });
    expect(matchTerm("wave", "")).toEqual({ score: 0, ranges: [] });
  });

  it("treats an empty term as the empty query", () => {
    expect(matchTerm("", "anything")).toEqual({ score: 1, ranges: [] });
  });

  it("reports the matched span for a mid-string hit", () => {
    expect(matchTerm("wall", "Set wallpaper").ranges).toEqual([[4, 8]]);
  });
});

describe("matchRanges", () => {
  it("collects one range per word of a multi-word query", () => {
    expect(matchRanges("set wal", "Set wallpaper")).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it("merges overlapping and touching ranges so no letter is drawn twice", () => {
    // "wall" [0,4) and "llp" [2,5) share two letters; one range comes out.
    expect(matchRanges("wall llp", "wallpaper")).toEqual([[0, 5]]);
    expect(matchRanges("wall paper", "wallpaper")).toEqual([[0, 9]]);
  });

  it("spans a scattered subsequence", () => {
    expect(matchRanges("sw", "soundwave")).toEqual([
      [0, 1],
      [5, 6],
    ]);
  });

  it("stays empty when the query only matched the hidden keywords", () => {
    expect(matchRanges("resume", "Anything else")).toEqual([]);
  });
});

describe("scoreCommand", () => {
  it("scores an empty query as equal for everyone", () => {
    expect(scoreCommand("", { label: "Anything" })).toBe(1);
    expect(scoreCommand("   ", { label: "Anything" })).toBe(1);
  });

  it("requires every word of the query to land somewhere", () => {
    expect(scoreCommand("set wav", { label: "Set waveform" })).toBeGreaterThan(0);
    expect(scoreCommand("set zzz", { label: "Set waveform" })).toBe(0);
  });

  it("ranks the label above the same hit on the keywords", () => {
    const onLabel = scoreCommand("wave", { label: "Wave stuff" });
    const onKeywords = scoreCommand("wave", { label: "Zzz", keywords: "wave stuff" });
    expect(onLabel).toBeGreaterThan(onKeywords);
    expect(onKeywords).toBeGreaterThan(0); // still findable, just not first
  });

  it("ranks the label above the same hit on the section", () => {
    const onLabel = scoreCommand("app", { label: "App store" });
    const onGroup = scoreCommand("app", { label: "Zzz", group: "Applications" });
    expect(onLabel).toBeGreaterThan(onGroup);
    expect(onGroup).toBeGreaterThan(0);
  });

  it("lets naming a section outright beat a mere label prefix", () => {
    // Typing "app" is how someone asks for the App section; "Apply profile…"
    // only contains the letters.
    const section = scoreCommand("app", { label: "Wipe app data…", group: "App" });
    const contains = scoreCommand("app", { label: "Apply profile…", group: "Navigate" });
    expect(section).toBeGreaterThan(contains);
  });
});

describe("withPinnedRecents", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const idOf = (x: { id: string }) => x.id;

  it("lists pinned first, then recent, then the rest in order", () => {
    expect(withPinnedRecents(items, ["c"], ["b"], idOf).map(idOf)).toEqual(["c", "b", "a"]);
  });

  it("dedupes across the three sources", () => {
    expect(withPinnedRecents(items, ["a", "b"], ["b", "a"], idOf).map(idOf)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("drops ids that no longer resolve to a command", () => {
    expect(withPinnedRecents(items, ["ghost"], ["gone", "b"], idOf).map(idOf)).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  it("leaves the list untouched when both lists are empty", () => {
    expect(withPinnedRecents(items, [], [], idOf)).toEqual(items);
  });
});

describe("parseQuery", () => {
  it("splits a leading prefix from the term", () => {
    expect(parseQuery("#sunset")).toEqual({ prefix: "#", term: "sunset" });
    expect(parseQuery("@work")).toEqual({ prefix: "@", term: "work" });
  });

  it("passes plain text through untouched", () => {
    expect(parseQuery("brightness")).toEqual({ prefix: null, term: "brightness" });
    expect(parseQuery("")).toEqual({ prefix: null, term: "" });
  });

  it("treats a lone prefix as an empty term, to browse the whole list", () => {
    expect(parseQuery("#")).toEqual({ prefix: "#", term: "" });
  });

  it("reads a prefix only in first position", () => {
    expect(parseQuery("sunset #2")).toEqual({ prefix: null, term: "sunset #2" });
    expect(parseQuery(" work")).toEqual({ prefix: null, term: " work" });
  });
});
