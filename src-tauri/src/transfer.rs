// Import and export for profiles and the whole config, as JSON on disk.
//
// Both directions are ordinary file operations; almost none of the risk is in
// the reading and writing, it is in what happens when two machines' worth of
// data meet. So the decisions live here, away from any I/O, and the commands in
// `ipc.rs` are the thin layer that owns the dialogs.
//
// Three of those decisions are load-bearing and each is a place where the
// obvious implementation is wrong:
//
// * **Ids are reminted on import.** A profile id is referenced by
//   `general.active_profile_id`, by playlists, and by anything the user's own
//   tooling points at. Importing a file that carries someone else's ids would
//   overwrite the local profile that happens to share the id — and the export
//   format is a JSON file a person can copy around, so a shared id is the normal
//   case, not the exotic one.
//
// * **Names are uniqued, not trusted.** Two profiles called "Night" from two
//   machines must both survive. Silently dropping the second loses someone's
//   setup with no error anywhere; overwriting the first destroys work that was
//   never overwritten from.
//
// * **Config import is a whole-file replace, never a merge.** Merging a config
//   means deciding what happens to gallery entries pointing at files that only
//   exist on the other machine, and there is no answer that is right in
//   general. A replace is predictable and reversible, because the caller is
//   expected to export first.
//
// What is deliberately NOT exported: `general.active_profile_id` (meaningless
// off this machine), the log, thumbnails and the OpenRGB install. Those are
// either derived or re-obtained, and shipping them makes the file bigger and the
// import less predictable.

use serde::{Deserialize, Serialize};

use crate::config::{Config, SceneProfile, CONFIG_VERSION};

/// Envelope version, separate from `CONFIG_VERSION`.
///
/// `CONFIG_VERSION` tracks the *runtime* schema and goes up when a field is
/// added. This tracks the *file format* and goes up only when something about
/// the file itself changes shape — renaming the payload key, wrapping it
/// differently. They move independently on purpose: a config field added next
/// release must not make last month's export file unreadable.
pub const TRANSFER_FORMAT: u32 = 1;

/// Marker string so a wrong file is refused with a useful message rather than a
/// serde error about a missing field.
const TRANSFER_KIND: &str = "lumendeck-transfer";

/// What an export file holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferKind {
    /// One or more profiles, merged into the ones already here.
    Profiles,
    /// A whole config, replacing the one already here.
    Config,
}

/// The file. `format` is the envelope version, `app` is the version that wrote
/// it — recorded so a future reader can say "written by a newer LumenDeck"
/// instead of failing on an unknown field.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferFile {
    /// Always `lumendeck-transfer`. A separate field from `kind` because the
    /// two answer different questions: this one says "is this our file at all",
    /// the other says "which of the two payloads is populated". A random
    /// `config.json` has neither, and the first is the useful error.
    pub app: String,
    pub kind: TransferKind,
    pub format: u32,
    /// The LumenDeck version that wrote the file. Recorded so a future reader
    /// can say "written by 0.3.1" instead of failing on an unknown field.
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub profiles: Vec<SceneProfile>,
    #[serde(default)]
    pub config: Option<Config>,
}

/// Build the file for an export. `profiles` is ignored for a config export and
/// vice versa, so a caller does not have to clear the other field by hand.
pub fn build_export(
    kind: TransferKind,
    cfg: &Config,
    app_version: &str,
    profiles: &[SceneProfile],
) -> TransferFile {
    match kind {
        TransferKind::Profiles => TransferFile {
            app: TRANSFER_KIND.to_string(),
            kind,
            format: TRANSFER_FORMAT,
            app_version: app_version.to_string(),
            profiles: profiles.to_vec(),
            config: None,
        },
        TransferKind::Config => TransferFile {
            app: TRANSFER_KIND.to_string(),
            kind,
            format: TRANSFER_FORMAT,
            app_version: app_version.to_string(),
            profiles: Vec::new(),
            config: Some(exportable_config(cfg)),
        },
    }
}

/// Pretty-printed, so an export is readable and hand-editable in a text editor.
pub fn to_json(file: &TransferFile) -> String {
    serde_json::to_string_pretty(file).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

/// The config as it should leave this machine.
///
/// Strips the two things that are true only here: the pointer to whichever
/// profile is currently running, and any profile whose id would not survive a
/// round trip anyway (there are none today, but the reminting on import is what
/// makes that safe to assume).
pub fn exportable_config(cfg: &Config) -> Config {
    let mut out = cfg.clone();
    out.general.active_profile_id = None;
    // Every profile goes out with a fresh id, for the same reason import
    // remints: an exported id is a claim about a machine this file may end up
    // on, and the importing side is the only one that knows the local ids.
    for scene in out.scenes.iter_mut() {
        scene.id = String::new();
    }
    out
}

/// What an import resolved to, before anything is written.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportPlan {
    /// Profiles to append, already reminted and renamed.
    pub profiles: Vec<SceneProfile>,
    /// Present only for a config import.
    pub config: Option<Config>,
}

/// Read and validate an export file.
///
/// Three checks, each refusing a file that would do damage rather than
/// returning something the caller has to think about:
///
/// * the `kind` marker, so a photo or a `config.json` is refused clearly
/// * the envelope version, so a file from a future build is refused rather than
///   half-read
/// * that the payload for the declared kind is actually present, so a profiles
///   file with no profiles cannot quietly become a no-op that reports success
pub fn parse_export(text: &str) -> Result<TransferFile, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("not a LumenDeck export file: {e}"))?;
    // Checked before the typed parse so a random JSON file gets the marker
    // message rather than "missing field `kind`".
    if value.get("app").and_then(|k| k.as_str()) != Some(TRANSFER_KIND) {
        return Err(format!(
            "not a LumenDeck export file (expected \"{TRANSFER_KIND}\")"
        ));
    }
    let file: TransferFile =
        serde_json::from_value(value).map_err(|e| format!("could not read the export: {e}"))?;
    if file.format > TRANSFER_FORMAT {
        return Err(format!(
            "written by a newer LumenDeck (export format v{}, this build reads v{TRANSFER_FORMAT})",
            file.format
        ));
    }
    match file.kind {
        TransferKind::Profiles if file.profiles.is_empty() => {
            Err("the file contains no profiles".into())
        }
        TransferKind::Config if file.config.is_none() => {
            Err("the file contains no configuration".into())
        }
        _ => Ok(file),
    }
}

/// Merge imported profiles into the existing list.
///
/// Both lists come out of here: the caller's profiles are untouched, because
/// importing two profiles should never be able to delete the four already on
/// the machine. The only thing that changes about an existing profile is
/// nothing.
pub fn merge_profiles(
    existing: &[SceneProfile],
    mut incoming: Vec<SceneProfile>,
    mint_id: &mut dyn FnMut() -> String,
) -> Vec<SceneProfile> {
    let mut out = existing.to_vec();
    for mut scene in incoming.drain(..) {
        // Fresh id every time, including for a profile that is otherwise a
        // byte-identical duplicate. Deciding "this one is already here" from
        // content is a guess — the user may well want two Night profiles for two
        // monitors — and a wrong guess silently discards someone's work.
        //
        // Minted until it is genuinely free rather than taken once. The caller's
        // generator is timestamp-based and a whole import file is processed in
        // well under a millisecond, so two profiles in one file can easily come
        // back with the same id. Two profiles sharing an id is not a cosmetic
        // duplicate: recalling one recalls both, and deleting one deletes both.
        scene.id = fresh_id(&out, mint_id);
        let name = unique_name(&scene.name, &|n| {
            out.iter().any(|s| s.name.eq_ignore_ascii_case(n))
        });
        scene.name = name;
        out.push(scene);
    }
    out
}

/// A minted id not already used by `taken`.
///
/// Bounded rather than looping forever: a generator that returns one constant
/// would otherwise hang the import. After the budget it falls back to the last
/// attempt plus a counter, which is still unique because it is not in the list.
fn fresh_id(taken: &[SceneProfile], mint: &mut dyn FnMut() -> String) -> String {
    for _ in 0..64 {
        let candidate = mint();
        if !taken.iter().any(|s| s.id == candidate) {
            return candidate;
        }
    }
    let mut n = 2;
    loop {
        let candidate = format!("{}-{}", mint(), n);
        if !taken.iter().any(|s| s.id == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// A profile name not already in `taken`, with a counter appended.
///
/// Case-insensitively, because "Night" and "night" are the same name to a
/// person reading a list, and the count starts at 2 so the first duplicate reads
/// "Night 2" rather than the more cryptic "Night (1)".
fn unique_name(base: &str, taken: &dyn Fn(&str) -> bool) -> String {
    let base = if base.trim().is_empty() {
        "Profile"
    } else {
        base.trim()
    };
    if !taken(base) {
        return base.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} {n}");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// Work out what an import would do, without writing anything.
///
/// Separate from the write so the caller can show a summary and get a yes, and
/// so a malformed file is refused before the current config is anywhere near
/// being replaced.
pub fn plan_import(
    text: &str,
    cfg: &Config,
    mint_id: &mut dyn FnMut() -> String,
) -> Result<ImportPlan, String> {
    let file = parse_export(text)?;
    Ok(match file.kind {
        TransferKind::Profiles => ImportPlan {
            profiles: merge_profiles(&cfg.scenes, file.profiles, mint_id),
            config: None,
        },
        TransferKind::Config => {
            let mut incoming = file.config.unwrap_or_default();
            // Same reason as the export side, and needed even more here: the
            // file's profiles keep their exported ids, and those must not
            // collide with anything here. Uniqueness is enforced across the
            // batch for the same reason as in `merge_profiles` — a replace still
            // has to be a vault where each profile is its own profile.
            //
            // Drained rather than borrowed so each id is checked against the
            // ones already re-minted, which a `&mut` borrow of the same vec
            // cannot do.
            let mut fresh_ids: Vec<SceneProfile> = Vec::with_capacity(incoming.scenes.len());
            for mut scene in incoming.scenes.drain(..) {
                scene.id = fresh_id(&fresh_ids, mint_id);
                fresh_ids.push(scene);
            }
            incoming.scenes = fresh_ids;
            incoming.general.active_profile_id = None;
            // The file was written by some version of this app, possibly older.
            // Migrating it means an export from a previous release imports
            // cleanly instead of failing on a field that did not exist yet.
            let mut raw = serde_json::to_value(&incoming).map_err(crate::error::err_str)?;
            crate::config::migrate(&mut raw, None)?;
            let migrated: Config = serde_json::from_value(raw)
                .map_err(|e| format!("the configuration is not one this build understands: {e}"))?;
            ImportPlan {
                profiles: Vec::new(),
                config: Some(migrated),
            }
        }
    })
}

/// The schema version a config export carries, for the UI's "written by" line.
pub fn config_version_of(cfg: &Config) -> u32 {
    cfg.version.max(CONFIG_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene(name: &str, id: &str) -> SceneProfile {
        SceneProfile {
            id: id.to_string(),
            name: name.to_string(),
            created_ms: 1,
            ..Default::default()
        }
    }

    /// Deterministic ids so a test can assert on them.
    fn counter() -> impl FnMut() -> String {
        let mut n = 0;
        move || {
            n += 1;
            format!("new-{n}")
        }
    }

    #[test]
    fn a_profiles_export_round_trips() {
        let cfg = Config::default();
        let profiles = vec![scene("Night", "scene-a"), scene("Day", "scene-b")];
        let text = to_json(&build_export(
            TransferKind::Profiles,
            &cfg,
            "0.2.33",
            &profiles,
        ));
        let parsed = parse_export(&text).unwrap();
        assert_eq!(parsed.kind, TransferKind::Profiles);
        assert_eq!(parsed.profiles.len(), 2);
        assert_eq!(parsed.profiles[0].name, "Night");
        assert_eq!(parsed.app_version, "0.2.33");
        assert_eq!(parsed.app, TRANSFER_KIND);
    }

    #[test]
    fn a_config_export_does_not_carry_the_running_profile_pointer() {
        // Meaningless on another machine, and honouring it would switch the
        // user's look on as a side effect of restoring a backup.
        let mut cfg = Config::default();
        cfg.general.active_profile_id = Some("scene-here".into());
        let out = to_json(&build_export(TransferKind::Config, &cfg, "0.2.33", &[]));
        let parsed = parse_export(&out).unwrap();
        let imported = parsed.config.unwrap();
        assert!(imported.general.active_profile_id.is_none());
    }

    #[test]
    fn an_exported_config_carries_no_profile_ids() {
        // Ids are minted on import, so exporting them would only invite a
        // collision with whatever the importing machine already has.
        let mut cfg = Config::default();
        cfg.scenes = vec![scene("Night", "scene-a")];
        let exported = exportable_config(&cfg);
        assert_eq!(exported.scenes[0].id, "");
    }

    #[test]
    fn importing_profiles_never_overwrites_a_local_one() {
        // The whole point of reminting. Same id in the file as on disk, and the
        // local profile must survive with its own id.
        let existing = vec![scene("Night", "scene-local")];
        let merged = merge_profiles(
            &existing,
            vec![scene("Night", "scene-local")],
            &mut counter(),
        );
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].id, "scene-local");
        assert_ne!(merged[1].id, "scene-local");
    }

    #[test]
    fn a_clashing_name_gets_a_counter_rather_than_overwriting() {
        let existing = vec![scene("Night", "a")];
        let merged = merge_profiles(&existing, vec![scene("Night", "b")], &mut counter());
        assert_eq!(merged[1].name, "Night 2");
        // And a third one keeps counting rather than colliding with the second.
        let merged2 = merge_profiles(&merged, vec![scene("Night", "c")], &mut counter());
        assert_eq!(merged2[2].name, "Night 3");
    }

    #[test]
    fn duplicate_names_are_matched_case_insensitively() {
        let existing = vec![scene("night", "a")];
        let merged = merge_profiles(&existing, vec![scene("Night", "b")], &mut counter());
        assert_eq!(merged[1].name, "Night 2");
    }

    #[test]
    fn a_blank_imported_name_gets_something_readable() {
        let merged = merge_profiles(&[], vec![scene("   ", "a")], &mut counter());
        assert_eq!(merged[0].name, "Profile");
    }

    #[test]
    fn a_json_file_that_is_not_an_export_is_refused_clearly() {
        // The marker check, not a serde error about a missing field.
        let err = parse_export(r#"{"version": 2, "general": {}}"#).unwrap_err();
        assert!(err.contains("not a LumenDeck export"), "got: {err}");
    }

    #[test]
    fn a_future_export_format_is_refused_rather_than_half_read() {
        let text = r#"{"app":"lumendeck-transfer","kind":"profiles","format":99,"app_version":"9.9.9"}"#;
        let err = parse_export(text).unwrap_err();
        assert!(err.contains("newer LumenDeck"), "got: {err}");
    }

    #[test]
    fn a_profiles_file_with_no_profiles_is_an_error_not_a_silent_no_op() {
        // A no-op that reports success is how a user concludes their backup is
        // restored when nothing happened.
        let text = r#"{"app":"lumendeck-transfer","kind":"profiles","format":1}"#;
        assert!(parse_export(text).unwrap_err().contains("no profiles"));
    }

    #[test]
    fn a_config_file_with_no_config_is_refused() {
        let text = r#"{"app":"lumendeck-transfer","kind":"config","format":1,"profiles":[]}"#;
        assert!(parse_export(text).unwrap_err().contains("no configuration"));
    }

    #[test]
    fn malformed_json_is_refused_not_panicked() {
        assert!(parse_export("{not json").is_err());
        assert!(parse_export("").is_err());
    }

    #[test]
    fn a_config_import_replaces_rather_than_merges() {
        // Predictability is the whole contract: a restore is what you get, not a
        // union with whatever was here before.
        let mut theirs = Config::default();
        theirs.general.autostart = true;
        theirs.scenes = vec![scene("Theirs", "x")];
        let text = to_json(&build_export(TransferKind::Config, &theirs, "0.2.33", &[]));

        let mut mine = Config::default();
        mine.general.autostart = false;
        mine.scenes = vec![scene("Mine", "y")];
        let plan = plan_import(&text, &mine, &mut counter()).unwrap();
        let restored = plan.config.unwrap();
        assert!(restored.general.autostart, "theirs wins outright");
        assert_eq!(restored.scenes.len(), 1);
        assert_eq!(restored.scenes[0].name, "Theirs");
        assert_ne!(restored.scenes[0].id, "x", "ids are reminted on the way in");
    }

    #[test]
    fn planning_an_import_does_not_touch_the_live_profiles() {
        let existing = vec![scene("Mine", "scene-mine")];
        let text = to_json(&build_export(
            TransferKind::Profiles,
            &Config::default(),
            "0.2.33",
            &[scene("Theirs", "scene-theirs")],
        ));
        let plan = plan_import(&text, &Config::default(), &mut counter()).unwrap();
        // The plan carries both, and the caller's list is a separate value.
        assert_eq!(plan.profiles.len(), 1);
        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].id, "scene-mine");
    }

    #[test]
    fn a_generator_that_repeats_still_yields_distinct_ids() {
        // The real generator is timestamp-based, and an import file is processed
        // faster than a millisecond, so every profile in one file can come back
        // with the same id. Two profiles sharing one is not cosmetic: recalling
        // either recalls both.
        let mut always_same = || "same".to_string();
        let merged = merge_profiles(
            &[],
            vec![scene("A", "a"), scene("B", "b"), scene("C", "c")],
            &mut always_same,
        );
        let ids: Vec<&str> = merged.iter().map(|s| s.id.as_str()).collect();
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "ids must be distinct: {ids:?}");
    }

    #[test]
    fn a_generator_that_repeats_does_not_reuse_a_local_id() {
        // Same hazard, against a profile that was already here.
        let mut always_same = || "scene-local".to_string();
        let merged = merge_profiles(
            &[scene("Mine", "scene-local")],
            vec![scene("Theirs", "x")],
            &mut always_same,
        );
        assert_eq!(merged.len(), 2);
        assert_ne!(merged[0].id, merged[1].id);
    }

    #[test]
    fn a_config_import_mints_distinct_ids_when_the_generator_repeats() {
        // The same hazard as the profiles path, on the path where it does the
        // most damage: a replace leaves every profile sharing an id, so recalling
        // one recalls the lot.
        let raw = serde_json::json!({
            "app": TRANSFER_KIND,
            "kind": "config",
            "format": 1,
            "app_version": "0.2.33",
            "config": {
                "version": CONFIG_VERSION,
                "scenes": [
                    {"id": "x", "name": "A", "wallpaper": {}, "rgb": {}, "stickers": [], "logo": null, "createdMs": 1},
                    {"id": "y", "name": "B", "wallpaper": {}, "rgb": {}, "stickers": [], "logo": null, "createdMs": 1},
                    {"id": "z", "name": "C", "wallpaper": {}, "rgb": {}, "stickers": [], "logo": null, "createdMs": 1}
                ]
            }
        });
        let mut always_same = || "same".to_string();
        let plan = plan_import(&raw.to_string(), &Config::default(), &mut always_same).unwrap();
        let restored = plan.config.unwrap();
        let ids: Vec<&str> = restored.scenes.iter().map(|s| s.id.as_str()).collect();
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "ids must be distinct: {ids:?}");
    }

    #[test]
    fn a_config_export_file_is_marked_as_one() {
        // The marker is what lets a wrong file be refused with a useful
        // message, so it has to actually be written.
        let text = to_json(&build_export(TransferKind::Config, &Config::default(), "1.0", &[]));
        let raw: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(raw["app"], TRANSFER_KIND);
        assert_eq!(raw["kind"], "config");
        assert!(raw["config"].is_object());
    }

    #[test]
    fn a_config_import_does_not_adopt_the_files_running_profile_pointer() {
        // The export side cannot produce this, so the only way in is a
        // hand-edited file — and a file is exactly what people edit. Honouring
        // it would switch the user's look on as a side effect of a restore, and
        // the id it points at has just been reminted, so it would point at
        // nothing anyway.
        // Built as raw JSON rather than through `build_export`, because the export
        // side already nulls this and would therefore mask the import rule the
        // test exists to pin.
        let raw = serde_json::json!({
            "app": TRANSFER_KIND,
            "kind": "config",
            "format": 1,
            "app_version": "0.2.33",
            "config": {
                "version": CONFIG_VERSION,
                "general": {"activeProfileId": "scene-theirs"},
                "scenes": [{
                    "id": "scene-theirs",
                    "name": "Theirs",
                    "wallpaper": {"kind": "shader", "source": "aurora"},
                    "rgb": {},
                    "stickers": [],
                    "logo": null,
                    "createdMs": 1
                }]
            }
        });

        let plan = plan_import(&raw.to_string(), &Config::default(), &mut counter()).unwrap();
        let restored = plan.config.unwrap();
        assert!(
            restored.general.active_profile_id.is_none(),
            "a restore must not change which look is running"
        );
    }

    #[test]
    fn importing_a_config_migrates_an_older_schema() {
        // An export from a previous release carries fields this build has moved
        // on from. Without the migrate call that import fails outright, which is
        // the opposite of what a backup is for.
        let old = serde_json::json!({
            "app": TRANSFER_KIND,
            "kind": "config",
            "format": 1,
            "app_version": "0.1.0",
            "config": {
                "version": 1,
                "general": {"autostart": true},
                "wallpaper": {"kind": "shader", "source": "aurora"}
            }
        });
        let plan = plan_import(&old.to_string(), &Config::default(), &mut counter()).unwrap();
        let restored = plan.config.unwrap();
        assert!(
            restored.general.autostart,
            "the user's setting survives migration"
        );
    }
}