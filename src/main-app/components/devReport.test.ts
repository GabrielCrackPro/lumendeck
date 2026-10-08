import { describe, expect, it } from "vitest";
import { buildReport } from "./devReport";

const HEADER = "LumenDeck 0.2.7 — ac91689-dirty (log level info)";

describe("buildReport", () => {
  it("leads with the header so the build is named even with no facts", () => {
    const report = buildReport(HEADER, [], null);
    expect(report).toBe(HEADER);
    expect(report).toContain("ac91689-dirty");
  });

  it("keeps the build identity when the fact rows omit it entirely", () => {
    const report = buildReport(HEADER, [["Platform", "Win32"]], null);
    expect(report.split("\n")[0]).toBe(HEADER);
    expect(report).toContain("ac91689-dirty");
  });

  it("appends one line per fact, label first", () => {
    const report = buildReport(HEADER, [
      ["Version", "0.2.7"],
      ["Log file", "C:\\logs\\lumendeck.log"],
    ], null);
    expect(report.split("\n").slice(1)).toEqual([
      "Version: 0.2.7",
      "Log file: C:\\logs\\lumendeck.log",
    ]);
  });

  it("skips rows the backend could not answer", () => {
    const report = buildReport(HEADER, [
      ["Commit", ""],
      ["", "orphan"],
      ["Platform", "Win32"],
    ], null);
    expect(report).not.toContain("Commit");
    expect(report).not.toContain("orphan");
    expect(report).toContain("Platform: Win32");
  });

  it("appends the panic line last, unmodified", () => {
    const panic =
      "PANIC in thread 'rgb-worker' at src/rgb/mod.rs:42: index out of bounds [build ac91689-dirty]";
    const report = buildReport(HEADER, [["Version", "0.2.7"]], panic);
    expect(report.split("\n").pop()).toBe(panic);
  });

  it("omits the panic line when there has been no panic", () => {
    const report = buildReport(HEADER, [["Version", "0.2.7"]], null);
    expect(report).toBe(`${HEADER}\nVersion: 0.2.7`);
  });

  it("tolerates a blank header rather than emitting a leading blank line", () => {
    const report = buildReport("   ", [["Version", "0.2.7"]], null);
    expect(report).toBe("Version: 0.2.7");
  });
});
