import { useCallback, useState } from "react";
import { usePending } from "../pending";
import { useStore } from "../store";
import { api } from "../ipc";
import { t } from "../i18n";
import { truncateError } from "../utilities";
import { activeConfigId, type SceneTarget } from "./profileMatch";
import { applyingConfigKey, canDeleteProfile, configPendingKey } from "./configPicker";
import type { SceneProfile } from "@shared/types";

/**
 * Switching and capturing configs, for both surfaces that offer it.
 *
 * Two call sites that each grew their own copy of this is how the header chip
 * and the Settings card ended up disagreeing about which config is running —
 * one marked the row by name and the other by id. The decision of *what is
 * current* belongs to `activeConfigId`, the in-flight row to the pending set,
 * and the writing of a capture to one place, all of which live beside this hook
 * rather than inside a tab.
 */
/**
 * Takes no arguments and reads the config itself, on purpose.
 *
 * Every surface that offers the picker wants the same three things — the list,
 * what is applied, and the state to match against — and building those at each
 * call site is how two of them end up disagreeing about which profile is
 * current. One derivation, here, cannot drift.
 */
export function useConfigPicker() {
  const cfg = useStore((s) => s.cfg);
  const scenes: readonly SceneProfile[] = cfg?.scenes ?? [];
  /**
   * The current state to match against, or undefined before the config has
   * loaded. Undefined is not an error — it means nothing can be running yet,
   * which is the same answer as "nothing matches".
   */
  const target: SceneTarget | undefined = cfg
    ? {
        wallpaper: { kind: cfg.wallpaper.kind, source: cfg.wallpaper.source },
        rgb: cfg.rgb,
        stickers: cfg.stickers,
      }
    : undefined;
  /**
   * The id the backend says is applied. Preferred over matching the state,
   * because two profiles can describe the same look and only the id says which
   * one the user picked. Null means "trust the match" — a config written before
   * the field existed has no id, and its profiles should still light up.
   */
  const appliedId = cfg?.general.activeProfileId ?? null;
  const { pending, run } = usePending({ exclusive: true });
  const [open, setOpen] = useState(false);
  // The modal opens on the list from a place that already shows what is
  // running, and straight into the name field from Settings' capture button,
  // which is a request to save rather than to browse.
  const [startInSave, setStartInSave] = useState(false);

  const openBrowse = useCallback(() => {
    setStartInSave(false);
    setOpen(true);
  }, []);
  const openSave = useCallback(() => {
    setStartInSave(true);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);

  const apply = useCallback(
    (id: string) => {
      void run(configPendingKey(id), () => api.sceneApply(id), () =>
        useStore.getState().toast("error", t("common.apply-failed")),
      ).then((ok) => {
        // Closing on success only: a failure the dialog swallowed would leave
        // the list looking like nothing happened.
        if (ok) setOpen(false);
      });
    },
    [run],
  );

  /**
   * Capture the current look. Resolves to whether it was written — not to a
   * rejection — because the caller's job is to decide whether to clear the
   * name the user typed, and a swallowed failure would erase it.
   */
  const save = useCallback(
    (name: string) =>
      run(
        "scene-save",
        async () => {
          await api.sceneSave(name);
          // Re-read rather than pushing the returned scene into the store: the
          // capture happened on the Rust side, and its view of the config is
          // the one that was actually written.
          useStore.setState({ cfg: await api.getConfig() });
          useStore
            .getState()
            .toast("ok", t("common.profile-{name}-saved", { name }));
        },
        (e) =>
          useStore
            .getState()
            .toast(
              "error",
              t("common.save-failed-{error}", { error: truncateError(e) }),
            ),
      ),
    [run],
  );

  /**
   * Rename in place. Blank input is refused rather than saved: an unnamed
   * config cannot be identified in a list, and the caller's input keeps what
   * was typed so the mistake is visible rather than silent.
   */
  const rename = useCallback(
    async (id: string, name: string) => {
      const wanted = name.trim();
      if (wanted.length === 0) return false;
      const clash = scenes.some(
        (s) =>
          s.id !== id && s.name.trim().toLocaleLowerCase() === wanted.toLocaleLowerCase(),
      );
      if (clash) return false;
      return run(`scene-rename-${id}`, async () => {
        await api.sceneRename(id, wanted);
        useStore.setState({ cfg: await api.getConfig() });
      }, (e) =>
        useStore
          .getState()
          .toast(
            "error",
            t("common.save-failed-{error}", { error: truncateError(e) }),
          ),
      );
    },
    [run, scenes],
  );

  /**
   * Delete, with the undo toast the Settings list already offered.
   *
   * Undo pushes the scene back verbatim rather than re-capturing it: it carries
   * its own wallpaper, lighting and stickers, and keeping its id means anything
   * pointing at it still resolves.
   */
  const remove = useCallback(
    (scene: SceneProfile) => {
      // Checked here as well as in the controls that offer it: this is the
      // function both surfaces call, so the rule holds even if a third one is
      // added later.
      if (!canDeleteProfile(scenes.length)) return;
      void run(`scene-delete-${scene.id}`, async () => {
        await api.sceneDelete(scene.id).catch(() => {});
        useStore.setState({ cfg: await api.getConfig() });
        useStore
          .getState()
          .undoDelete(t("common.deleted-profile", { name: scene.name }), (next) => {
            next.scenes.push(scene);
          });
      });
    },
    [run, scenes.length],
  );

  /**
   * Set or clear the avatar. Opens the OS file picker itself so the caller does
   * not have to know that picking and storing are one decision.
   */
  const setLogo = useCallback(
    async (id: string, source: string | null) =>
      run(`scene-logo-${id}`, async () => {
        await api.sceneSetLogo(id, source);
        useStore.setState({ cfg: await api.getConfig() });
      }, (e) =>
        useStore
          .getState()
          .toast(
            "error",
            t("common.save-failed-{error}", { error: truncateError(e) }),
          ),
      ),
    [run],
  );

  /**
   * Ask for an image and use it as the avatar. Cancelling the OS dialog is a
   * normal outcome, not an error, so it resolves false and toasts nothing.
   */
  const chooseLogo = useCallback(
    async (id: string) => {
      // `run` reports whether the call succeeded, not what it returned, so the
      // picked path is captured by the closure. Going through `run` at all is
      // what stops a second press stacking a second dialog behind the first.
      let file: string | null = null;
      await run(`pick-logo-${id}`, async () => {
        file = await api.pickImageFile();
      });
      if (!file) return false;
      return setLogo(id, file);
    },
    [run, setLogo],
  );

  // The applied id is only honoured while it still resolves: deleting the
  // profile from another surface must not leave the header naming a ghost.
  const applied =
    appliedId != null && scenes.some((s) => s.id === appliedId) ? appliedId : null;
  const activeId = applied ?? (target ? activeConfigId(scenes, target) : null);
  const activeScene = activeId
    ? (scenes.find((s) => s.id === activeId) ?? null)
    : null;
  // Both accessors read the one id. Deriving the name from a second, separate
  // match is how the header and the picker end up disagreeing about which
  // profile is current.
  const activeName = activeScene?.name ?? null;

  return {
    open,
    openBrowse,
    openSave,
    close,
    apply,
    save,
    rename,
    remove,
    setLogo,
    chooseLogo,
    startInSave,
    /** False when only one profile is left, which cannot be deleted. */
    canDelete: canDeleteProfile(scenes.length),
    scenes,
    activeId,
    activeName,
    activeScene,
    applyingId: applyingConfigKey(pending),
  };
}
