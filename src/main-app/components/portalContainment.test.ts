import { describe, expect, it } from "vitest";
import { isInsideAnchoredPanel } from "./portalContainment";

describe("isInsideAnchoredPanel", () => {
  const target = {} as Node;
  const element = (containsTarget: boolean) =>
    ({ contains: (candidate: Node) => containsTarget && candidate === target }) as Element;

  it.each([
    ["trigger", true, false, true],
    ["portalled panel", false, true, true],
    ["outside both", false, false, false],
  ])("recognizes a target inside the %s", (_name, inTrigger, inPanel, expected) => {
    expect(
      isInsideAnchoredPanel(target, element(inTrigger), element(inPanel)),
    ).toBe(expected);
  });

  it("treats absent elements as outside", () => {
    expect(isInsideAnchoredPanel(target, null, null)).toBe(false);
  });
});
