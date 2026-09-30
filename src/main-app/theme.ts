// Resolving the theme preference to the theme that is actually painted.
//
// "Follow system" is a third option, not a synonym for dark, and the two
// places that need to know the answer used to guess. Guessing is not
// cosmetic here: `readableOnTheme` corrects the accent against a surface, so
// resolving a light OS as "dark" tints the entire UI against the wrong
// background. One resolver, used by both, so they cannot disagree.
import { useEffect, useState } from "react";
import type { ThemeMode } from "@shared/types";

/** The two themes the app actually renders. */
export type ResolvedTheme = "light" | "dark";

/**
 * Collapse a preference into the theme that will be painted.
 *
 * `prefersLight` is passed in rather than read from `window` so this stays a
 * pure function — the OS query needs stubbing in tests, and a theme default
 * is exactly the kind of thing that must be provable without a browser.
 */
export function resolveTheme(
  pref: ThemeMode | undefined,
  prefersLight: boolean,
): ResolvedTheme {
  if (pref === "light") return "light";
  if (pref === "dark") return "dark";
  return prefersLight ? "light" : "dark";
}

/** prefers-color-scheme, defaulting to dark when the query is unavailable. */
export function osPrefersLight(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  );
}

/**
 * [resolveTheme] for the live config. While the preference is "system" it
 * subscribes to the OS, so flipping Windows to light mode retints the
 * dashboard without a restart. An explicit light/dark unsubscribes: there is
 * nothing left to watch.
 */
export function useEffectiveTheme(pref: ThemeMode | undefined): ResolvedTheme {
  const [prefersLight, setPrefersLight] = useState(osPrefersLight);

  useEffect(() => {
    if (
      pref !== "system" ||
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => setPrefersLight(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);

  return resolveTheme(pref, prefersLight);
}
