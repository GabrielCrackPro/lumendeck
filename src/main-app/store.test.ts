// Toast stacking rules. The keyed path has a branch worth pinning: a
// flapping device must update one card and count, not grow the stack.
import { describe, expect, it, beforeEach } from "vitest";
import { useStore } from "./store";

describe("toasts", () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
  });

  it("stacks unkeyed toasts", () => {
    const { toast } = useStore.getState();
    toast("info", "first");
    toast("info", "second");
    expect(useStore.getState().toasts).toHaveLength(2);
  });

  it("collapses a repeated key into one card with a count", () => {
    const { toast } = useStore.getState();
    toast("info", "Keyboard disconnected", { key: "device:1" });
    toast("ok", "Keyboard connected", { key: "device:1" });
    toast("info", "Keyboard disconnected", { key: "device:1" });

    const toasts = useStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    // The newest state wins: the card shows what is true now, not what was.
    expect(toasts[0]!.msg).toBe("Keyboard disconnected");
    expect(toasts[0]!.tone).toBe("info");
    expect(toasts[0]!.count).toBe(3);
  });

  it("keeps the card's id so the dismiss timer tracks one card", () => {
    const { toast } = useStore.getState();
    toast("info", "a", { key: "openrgb" });
    const first = useStore.getState().toasts[0]!.id;
    toast("info", "b", { key: "openrgb" });
    expect(useStore.getState().toasts[0]!.id).toBe(first);
  });

  it("does not merge different keys, nor unkeyed into keyed", () => {
    const { toast } = useStore.getState();
    toast("info", "a", { key: "device:1" });
    toast("info", "b", { key: "device:2" });
    toast("info", "c");
    expect(useStore.getState().toasts).toHaveLength(3);
    expect(useStore.getState().toasts.every((t) => t.count == null)).toBe(true);
  });
});
