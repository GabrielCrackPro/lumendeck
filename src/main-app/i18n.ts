// Localization for the dashboard.
//
// The catalog lives in `locales/*.json` at the repo root, shared with the
// Rust side (see `src-tauri/src/i18n.rs`), so the window and the tray can
// never disagree about what language the app is in. Three rules, applied on
// both sides from the same config field:
//
// 1. `auto` follows the Windows display language, which the backend reads via
//    `system_language` and hands us on boot.
// 2. An explicit choice always wins, even one we do not ship.
// 3. English is the fallback — for a language with no catalog, and for an
//    individual key with no entry.
//
// `t` is re-exported flat rather than pulled from a `useTranslation` hook in
// every component. Nothing in the tree is memoized, so one re-render from the
// root reaches every screen; threading a hook through twenty components to
// translate a string is a poor trade when the only thing it buys is a
// subscription twenty components do not need.
import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import en from "../../locales/en.json";
import es from "../../locales/es.json";
import { useStore } from "./store";

export type Locale = "en" | "es";

/** Locales with a catalog in the tree. Mirrors the Rust `SUPPORTED`. */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "es", label: "Español" },
];

/** The name each locale calls itself, in that language. Never translated. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
};

export const SUPPORTED: Locale[] = LOCALES.map((l) => l.id);

/**
 * Map a BCP-47 tag onto a locale we ship: exact match, then the primary
 * subtag. "es-MX" and "es-ES" both resolve to "es".
 */
export function fromTag(tag: string | null | undefined): Locale {
  if (!tag) return "en";
  const norm = tag.toLowerCase();
  if ((SUPPORTED as string[]).includes(norm)) return norm as Locale;
  const primary = norm.split(/[-_]/)[0] ?? "";
  return (SUPPORTED as string[]).includes(primary)
    ? (primary as Locale)
    : "en";
}

export function resolveLocale(
  pref: string | null | undefined,
  systemTag: string | null | undefined,
): Locale {
  if (pref && pref !== "auto") {
    return (SUPPORTED as string[]).includes(pref) ? (pref as Locale) : "en";
  }
  return fromTag(systemTag);
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
  },
  lng: "en",
  fallbackLng: "en",
  // Keys are namespaced by screen and read left to right; `count` would let a
  // value like "{n} devices" silently pick a plural form nobody wrote.
  interpolation: { escapeValue: false },
  returnNull: false,
});

/** The locale in force right now. */
export function currentLocale(): Locale {
  const s = useStore.getState();
  return resolveLocale(s.cfg?.general.language, s.systemLanguage);
}

/**
 * Point i18next at the resolved locale.
 *
 * Called on boot and whenever the preference changes. The `t` below reads
 * through i18next, so this is the single place the app's language is set.
 */
export function applyLocale(locale: Locale): void {
  if (i18next.language !== locale) void i18next.changeLanguage(locale);
}

export const t = i18next.t.bind(i18next) as (
  key: string,
  vars?: Record<string, string | number>,
) => string;

/**
 * Subscribe to the locale. Only the root needs this; it exists so that
 * changing the language repaints the app, and so `<html lang>` can follow.
 */
export function useLocale(): Locale {
  return useStore((s) => resolveLocale(s.cfg?.general.language, s.systemLanguage));
}
