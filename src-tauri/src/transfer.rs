
use serde::{Deserialize, Serialize};

use crate::config::{Config, SceneProfile, CONFIG_VERSION};

pub const TRANSFER_FORMAT: u32 = 1;

const TRANSFER_KIND: &str = "lumendeck-transfer";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TransferKind {
    Profiles,
    Config,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferFile {
    pub app: String,
    pub kind: TransferKind,
    pub format: u32,
    #[serde(default)]
    pub app_version: String,
    #[serde(default)]
    pub profiles: Vec<SceneProfile>,
    #[serde(default)]
    pub config: Option<Config>,
}

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

pub fn to_json(file: &TransferFile) -> String {
    serde_json::to_string_pretty(file).unwrap_or_else(|e| format!("{{\"error\":\"{e}\"}}"))
}

pub fn exportable_config(cfg: &Config) -> Config {
    let mut out = cfg.clone();
    out.general.active_profile_id = None;
    for scene in out.scenes.iter_mut() {
        scene.id = String::new();
    }
    out
}

#[derive(Debug, Clone, PartialEq)]
pub struct ImportPlan {
    pub profiles: Vec<SceneProfile>,
    pub config: Option<Config>,
}

pub fn parse_export(text: &str) -> Result<TransferFile, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("not a LumenDeck export file: {e}"))?;
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

pub fn merge_profiles(
    existing: &[SceneProfile],
    mut incoming: Vec<SceneProfile>,
    mint_id: &mut dyn FnMut() -> String,
) -> Vec<SceneProfile> {
    let mut out = existing.to_vec();
    for mut scene in incoming.drain(..) {
        scene.id = fresh_id(&out, mint_id);
        let name = unique_name(&scene.name, &|n| {
            out.iter().any(|s| s.name.eq_ignore_ascii_case(n))
        });
        scene.name = name;
        out.push(scene);
    }
    out
}

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
            let mut fresh_ids: Vec<SceneProfile> = Vec::with_capacity(incoming.scenes.len());
            for mut scene in incoming.scenes.drain(..) {
                scene.id = fresh_id(&fresh_ids, mint_id);
                fresh_ids.push(scene);
            }
            incoming.scenes = fresh_ids;
            incoming.general.active_profile_id = None;
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
        let mut cfg = Config::default();
        cfg.general.active_profile_id = Some("scene-here".into());
        let out = to_json(&build_export(TransferKind::Config, &cfg, "0.2.33", &[]));
        let parsed = parse_export(&out).unwrap();
        let imported = parsed.config.unwrap();
        assert!(imported.general.active_profile_id.is_none());
    }

    #[test]
    fn an_exported_config_carries_no_profile_ids() {
        let mut cfg = Config::default();
        cfg.scenes = vec![scene("Night", "scene-a")];
        let exported = exportable_config(&cfg);
        assert_eq!(exported.scenes[0].id, "");
    }

    #[test]
    fn importing_profiles_never_overwrites_a_local_one() {
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
        assert_eq!(plan.profiles.len(), 1);
        assert_eq!(existing.len(), 1);
        assert_eq!(existing[0].id, "scene-mine");
    }

    #[test]
    fn a_generator_that_repeats_still_yields_distinct_ids() {
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
        let text = to_json(&build_export(TransferKind::Config, &Config::default(), "1.0", &[]));
        let raw: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(raw["app"], TRANSFER_KIND);
        assert_eq!(raw["kind"], "config");
        assert!(raw["config"].is_object());
    }

    #[test]
    fn a_config_import_does_not_adopt_the_files_running_profile_pointer() {
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