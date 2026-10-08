
use std::sync::OnceLock;


pub const SUPPORTED: [&str; 2] = ["en", "es"];

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

pub fn system_language() -> &'static str {
  static TAG: OnceLock<String> = OnceLock::new();
  TAG
    .get_or_init(|| {
      let mut buf = [0u16; 85];
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

pub fn set_locale(locale: &str) {
  let _guard = locale_lock();
  set_locale_locked(locale);
}

fn set_locale_locked(locale: &str) {
  let _ = rust_i18n::set_locale(locale);
}

pub fn current() -> &'static str {
  let pref = crate::config_store::try_get()
    .map(|cfg| cfg.general.language)
    .unwrap_or_else(|| "auto".to_string());
  resolve(&pref)
}

#[cfg(test)]
pub fn t_in(locale: &str, key: &str) -> String {
  let _guard = locale_lock();
  t_in_locked(locale, key)
}

#[cfg(test)]
pub fn t_in_locked(locale: &str, key: &str) -> String {
  set_locale_locked(locale);
  crate::_rust_i18n_t!(key).into_owned()
}

fn locale_lock() -> std::sync::MutexGuard<'static, ()> {
  use std::sync::{Mutex, OnceLock};
  static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
  let m = LOCK.get_or_init(|| Mutex::new(()));
  m.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
pub(crate) fn test_locale_lock() -> std::sync::MutexGuard<'static, ()> {
  locale_lock()
}

pub fn t(key: &str) -> String {
  let _guard = locale_lock();
  set_locale_locked(current());
  crate::_rust_i18n_t!(key).into_owned()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn an_explicit_choice_beats_the_system() {
    assert_eq!(resolve("es"), "es");
    assert_eq!(resolve("ES"), "es");
    assert_eq!(resolve(" en "), "en");
  }

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

  #[test]
  fn tray_strings_are_translated_in_spanish() {
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

  #[test]
  fn an_untranslated_key_returns_the_english_source() {
    assert_eq!(
      t_in("es", "tray.some-string-added-later"),
      "tray.some-string-added-later"
    );
  }

  #[test]
  fn t_never_returns_two_languages_for_one_lookup() {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

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
    let _guard = locale_lock();
    set_locale_locked(mine);
  }
}
