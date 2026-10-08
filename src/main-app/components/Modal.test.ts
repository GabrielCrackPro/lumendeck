import { describe, expect, it } from "vitest";
import { isModalControlAvailable } from "./Modal";

describe("isModalControlAvailable", () => {
  it("accepts visible controls inside the dialog", () => {
    expect(
      isModalControlAvailable({
        hiddenByAncestor: false,
        hasLayoutBox: true,
        visibility: "visible",
      }),
    ).toBe(true);
  });

  it.each([
    ["aria-hidden subtrees", true, true, "visible"],
    ["inert subtrees", true, true, "visible"],
    ["display:none controls", false, false, "visible"],
    ["visibility:hidden controls", false, true, "hidden"],
    ["collapsed controls", false, true, "collapse"],
  ])("excludes controls in %s", (_reason, hiddenByAncestor, hasLayoutBox, visibility) => {
    expect(isModalControlAvailable({ hiddenByAncestor, hasLayoutBox, visibility })).toBe(false);
  });
});
