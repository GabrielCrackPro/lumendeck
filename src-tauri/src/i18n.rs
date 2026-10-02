//! Language resolution and the backend's own user-facing strings.
//!
//! Two audiences need translating and they live in different processes. The
//! strings come from ONE catalog — `locales/*.json` at the repo root, which
//! `i18next` reads in the window and `rust-i18n` reads here. There is no
//! second dictionary to drift out of sync, and a tray label that shares
//! wording with a dashboard label (the lighting mode names, say) is literally
//! the same key on both sides.
//!
//! Three rules, applied on both sides from the same config field:
//!
//! 1. `auto` follows the Windows display language.
//! 2. An explicit choice always wins, even one we do not ship — silently
//!    overriding it would leave the user with no way back.
//! 3. English is the fallback, both for a language with no catalog and for an
//!    individual key with no entry, so a gap reads as English rather than as
//!    an empty tray item.
//!
//! The catalogs are embedded at compile time with `include_str!` rather than
//! read at runtime: the tray can be rebuilt on any thread at any moment, and
//! a lookup that touched the filesystem would be a bug waiting to happen.

use std::sync::OnceLock;

// The `i18n!` invocation lives in `lib.rs` at the crate root, because
// `rust_i18n::t!` forwards to `crate::_rust_i18n_t!` — a macro that only
// exists where `i18n!` was expanded. This module is the app's whole surface
// over that generated macro; see [t].

/// Locales with a catalog in the tree. The frontend mirrors this list.
pub const SUPPORTED: [&str; 2] = ["en", "es"];

/// The user's preference: `auto` or a supported locale tag.
pub fn resolve(pref: &str) -> &'static str {
  let wanted = pref.trim().to_ascii_lowercase();
  if wanted != "auto" {
    return SUPPORTED
      .iter()
      .copied()
      .find(|l| *l == wanted)
      .unwrap_or("en");
  }
  from_tag(system_language())
}

/// The Windows display language as a BCP-47 tag ("es-ES"), or "en" if the
/// call fails. Read once and cached: it cannot change while the app runs, and
/// the tray rebuilds its menu on every state change.
pub fn system_language() -> &'static str {
  static TAG: OnceLock<String> = OnceLock::new();
  TAG
    .get_or_init(|| {
      let mut buf = [0u16; 85];
      // SAFETY: `buf` is a valid writable UTF-16 buffer of the length the API
      // asks for; the call only writes into it and NUL-terminates.
      let len = unsafe {
        windows::Win32::Globalization::GetUserDefaultLocaleName(&mut buf)
      };
      if len <= 0 {
        return "en".to_string();
      }
      String::from_utf16_lossy(&buf[..(len as usize).min(buf.len())])
    })
    .as_str()
}

/// Map a BCP-47 tag onto a shipped locale: exact match, then the primary
/// subtag. "es-MX" and "es-ES" both resolve to "es"; anything unknown to "en".
pub fn from_tag(tag: &str) -> &'static str {
  let lower = tag.trim().to_ascii_lowercase();
  let primary = lower.split(['-', '_']).next().unwrap_or("");
  SUPPORTED
    .iter()
    .copied()
    .find(|l| *l == lower)
    .or_else(|| SUPPORTED.iter().copied().find(|l| *l == primary))
    .unwrap_or("en")
}

/// Point rust-i18n at the locale in force.
///
/// Cheap and idempotent, so callers can invoke it before every tray rebuild
/// rather than tracking the language themselves. Takes the locale lock so a
/// bare `set_locale` from anywhere still cannot land between another thread's
/// `set` and its lookup.
pub fn set_locale(locale: &str) {
  let _guard = locale_lock();
  set_locale_locked(locale);
}

/// [set_locale] for a caller already holding the lock. A std Mutex is not
/// reentrant, so [t] has to come through here rather than through
/// [set_locale], or it would deadlock against its own guard.
fn set_locale_locked(locale: &str) {
  let _ = rust_i18n::set_locale(locale);
}

/// The current preference, resolved. Before the config store exists (early
/// boot, or a unit test that never calls `init`) there is no preference to
/// honour, so `auto` — and therefore the system language — is the answer. A
/// string is never dropped just because the store is not up yet.
pub fn current() -> &'static str {
  let pref = crate::config_store::try_get()
    .map(|cfg| cfg.general.language)
    .unwrap_or_else(|| "auto".to_string());
  resolve(&pref)
}

/// Look up a key in an explicit locale, ignoring the stored preference.
///
/// [t] is the function production code should use: it is the one that honours
/// the user's setting. This exists for tests, which must be able to assert
/// both languages on any machine — otherwise a Spanish-locale CI box would
/// quietly pass a test that only ever sees Spanish.
#[cfg(test)]
pub fn t_in(locale: &str, key: &str) -> String {
  let _guard = locale_lock();
  t_in_locked(locale, key)
}

/// [t_in] for a test that already holds the locale lock.
///
/// [t_in] takes the lock itself, and a std Mutex is not reentrant — a test
/// that holds the lock and then calls [t_in] would deadlock. A test comparing
/// several locales needs the lock held across the whole comparison, so it
/// calls this instead.
#[cfg(test)]
pub fn t_in_locked(locale: &str, key: &str) -> String {
  set_locale_locked(locale);
  crate::_rust_i18n_t!(key).into_owned()
}

/// Serialises the global locale: set it, read a string, and no other thread
/// can swap it in between.
///
/// This is not a test-only concern. The locale is process-global state inside
/// `rust_i18n`, the tray is rebuilt on its own thread, and [t] is called from
/// the IPC handlers and the sample path — so an unlocked set-then-lookup pair
/// could resolve one string in English and the next in Spanish, handing a
/// user a half-translated tray. Holding the lock across both halves is what
/// makes "the locale cannot drift from the lookup" true rather than intended.
fn locale_lock() -> std::sync::MutexGuard<'static, ()> {
  use std::sync::{Mutex, OnceLock};
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  let m = LOCK.get_or_init(|| Mutex::new(()));
  // A poisoned lock means a caller panicked while holding it, which is already
  // a failure; recovering keeps one broken call from masking the rest.
  m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Held for the duration of any test that inspects a specific locale.
///
/// Every test that asserts on a specific language must take this, and must use
/// [t_in_locked] rather than [t] while holding it — a std Mutex is not
/// reentrant, and [t] takes the lock itself.
#[cfg(test)]
pub(crate) fn test_locale_lock() -> std::sync::MutexGuard<'static, ()> {
  locale_lock()
}

/// Look up one of the backend's strings by key, in the locale in force.
///
/// `rust_i18n::t!` is a macro rather than a function, so the dynamic-key form
/// goes through the macro it generates. `set_locale` runs first because the
/// tray rebuilds on any thread at any moment, and this is the one place that
/// guarantees the lookup and the locale cannot drift apart.
///
/// Always owned: the generated macro ties any borrow to the key argument's
/// lifetime, and a Tauri menu item's title has to outlive this call anyway.
/// The copy happens at most twenty times per tray rebuild, which is not a
/// cost worth optimising at the price of a signature nobody can use.
pub fn t(key: &str) -> String {
  // The lock spans the set AND the lookup, not just the set. Releasing it
  // between them is what let a concurrent tray rebuild land a different
  // language in the gap, which showed up as a test that compared a Spanish
  // string against an English one and failed roughly one run in forty.
  let _guard = locale_lock();
  set_locale_locked(current());
  crate::_rust_i18n_t!(key).into_owned()
}

/// `t` for a key whose result must outlive the call, which is every Tauri
/// menu item. Keeping this in one place means the decision to copy is made
/// once rather than at each of the twenty call sites.
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_explicit_choice_beats_the_system() {
    assert_eq!(resolve("es"), "es");
    assert_eq!(resolve("ES"), "es");
    assert_eq!(resolve(" en "), "en");
  }

  /// A language we do not ship must not silently become "auto": the user asked
  /// for something specific and gets English rather than the system language.
  #[test]
  fn an_unsupported_explicit_choice_falls_back_to_english() {
    assert_eq!(resolve("fr"), "en");
    assert_eq!(resolve("de-AT"), "en");
  }

  #[test]
  fn auto_always_lands_on_a_shipped_locale() {
    let tag = system_language();
    assert!(!tag.is_empty(), "Windows reported no locale");
    assert!(SUPPORTED.contains(&resolve("auto")));
    assert!(SUPPORTED.contains(&from_tag(tag)));
  }

  #[test]
  fn regional_tags_fall_back_to_their_primary_language() {
    assert_eq!(from_tag("es-MX"), "es");
    assert_eq!(from_tag("es_ES"), "es");
    assert_eq!(from_tag("ES-es"), "es");
    assert_eq!(from_tag("en-GB"), "en");
  }

  #[test]
  fn unknown_tags_fall_back_to_english() {
    assert_eq!(from_tag("fr-CA"), "en");
    assert_eq!(from_tag(""), "en");
    assert_eq!(from_tag("klingon"), "en");
  }

  /// Every tray string must be a real translation: the same sentence, not the
  /// English string pasted back in under a Spanish-looking key. This is the
  /// check that catches a half-finished catalog, and it is why the tray reads
  /// the shared file rather than a hand-maintained table.
  #[test]
  fn tray_strings_are_translated_in_spanish() {
    // One lock for the whole test, not one per lookup: [t_in] takes the lock
    // itself, so holding it here too is what stops another test from swapping
    // the locale halfway through the comparison below.
    let _guard = test_locale_lock();
    for key in [
      "tray.open-dashboard",
      "tray.pause-wallpaper",
      "tray.edit-stickers",
      "tray.lighting-mode",
      "tray.profiles",
      "tray.quit",
      "tray.tooltip-idle",
      "tray.balloon-title",
      "tray.balloon-lights-live",
    ] {
      let translated = t_in_locked("es", key);
      assert!(!translated.is_empty(), "{key} came back empty");
      let english = t_in_locked("en", key);
      assert_ne!(translated, english, "{key} was not translated");
    }
  }

  /// The tray's lighting submenu and the dashboard's mode picker read the
  /// SAME keys — `lighting.*` — out of the same file. If someone ever adds a
  /// `tray.ambient` alongside `lighting.ambient`, the two can drift, and this
  /// is the check that says so.
  #[test]
  fn the_tray_reuses_the_dashboards_lighting_mode_keys() {
    let _guard = test_locale_lock();
    for key in [
      "lighting.ambient",
      "lighting.zone-sync",
      "lighting.pulse",
      "lighting.static",
      "lighting.color-cycle",
      "lighting.wave",
      "lighting.breathe",
      "lighting.audio-reactive",
    ] {
      let value = t_in_locked("es", key);
      assert!(!value.is_empty(), "{key} came back empty");
      assert_ne!(value, t_in_locked("en", key), "{key} was not translated");
    }
  }

  /// A key with no entry must return the English source, never an empty
  /// string: a blank tray item is worse than an untranslated one.
  #[test]
  fn an_untranslated_key_returns_the_english_source() {
    assert_eq!(
      t_in("es", "tray.some-string-added-later"),
      "tray.some-string-added-later"
    );
  }

  /// [t] has to resolve in ONE language per call, whatever another thread is
  /// doing to the process-global locale while it runs.
  ///
  /// This is the flake that cost real time: a startup-hint test compared a
  /// Spanish string against an English one roughly one run in forty, because
  /// the pair of calls in `t` — set the locale, then look the key up — was
  /// two separate critical sections, and a sibling test iterating the shipped
  /// locales landed in the gap. In production the same gap is a tray half in
  /// one language and half in another, so this asserts the invariant rather
  /// than only re-running the flaky comparison.
  #[test]
  fn t_never_returns_two_languages_for_one_lookup() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    // Whichever locale this machine resolves to, the writer pins the OTHER
    // one, so any string it leaks into a `t` call is visible.
    let mine = current();
    let other = if mine == "en" { "es" } else { "en" };
    let expected = t_in(mine, "tray.quit");

    let stop = Arc::new(AtomicBool::new(false));
    let writer = {
      let stop = Arc::clone(&stop);
      std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
          set_locale(other);
        }
      })
    };

    let mut wrong = 0;
    for _ in 0..20_000 {
      if t("tray.quit") != expected {
        wrong += 1;
      }
    }
    stop.store(true, Ordering::Relaxed);
    writer.join().unwrap();

    assert_eq!(
      wrong, 0,
      "{wrong} of 20000 lookups resolved in the other thread's locale"
    );
    // Leave the process in the locale production code would pick, so this test
    // does not leak `other` into whichever test happens to run next.
    let _guard = locale_lock();
    set_locale_locked(mine);
  }
}
