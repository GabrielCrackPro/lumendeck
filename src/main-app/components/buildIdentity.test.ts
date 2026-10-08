import { describe, expect, it } from "vitest";
import { versionDisagreement, versionLabel } from "./buildIdentity";

describe("versionLabel", () => {
  it("prefixes a bare version", () => {
    expect(versionLabel("0.2.7")).toBe("v0.2.7");
  });

  it("does not double a prefix the manifest already carries", () => {
    expect(versionLabel("v0.2.7")).toBe("v0.2.7");
  });

  it("trims surrounding whitespace", () => {
    expect(versionLabel(" 0.2.7\n")).toBe("v0.2.7");
  });

  it("returns nothing for an absent version", () => {
    expect(versionLabel("")).toBe("");
    expect(versionLabel("   ")).toBe("");
  });

  it("keeps prerelease and build metadata intact", () => {
    expect(versionLabel("0.3.0-rc.1")).toBe("v0.3.0-rc.1");
    expect(versionLabel("1.0.0+build.7")).toBe("v1.0.0+build.7");
  });
});

describe("versionDisagreement", () => {
  it("is false when the two sources agree", () => {
    expect(versionDisagreement("0.2.7", "0.2.7")).toBe(false);
  });

  it("is false when they differ only in the v prefix", () => {
    expect(versionDisagreement("0.2.7", "v0.2.7")).toBe(false);
    expect(versionDisagreement("v0.2.7", "0.2.7")).toBe(false);
  });

  it("is true when the numbers differ", () => {
    expect(versionDisagreement("0.2.7", "0.2.6")).toBe(true);
  });

  it("is false when either side is missing", () => {
    expect(versionDisagreement("", "0.2.7")).toBe(false);
    expect(versionDisagreement("0.2.7", "")).toBe(false);
    expect(versionDisagreement("", "")).toBe(false);
  });

  it("ignores surrounding whitespace", () => {
    expect(versionDisagreement("0.2.7", " 0.2.7 ")).toBe(false);
  });
});