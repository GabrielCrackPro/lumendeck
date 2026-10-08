import { useCallback, useState } from "react";
import { usePending } from "../pending";
import { useStore } from "../store";
import { api } from "../ipc";
import { t } from "../i18n";
import { truncateError } from "../utilities";
import { activeConfigId, type SceneTarget } from "./profileMatch";
import { applyingConfigKey, canDeleteProfile, configPendingKey } from "./configPicker";
import type { SceneProfile } from "@shared/types";

export function useConfigPicker() {
  const cfg = useStore((s) => s.cfg);
  const scenes: readonly SceneProfile[] = cfg?.scenes ?? [];
  const target: SceneTarget | undefined = cfg
    ? {
        wallpaper: { kind: cfg.wallpaper.kind, source: cfg.wallpaper.source },
        rgb: cfg.rgb,
        stickers: cfg.stickers,
      }
    : undefined;
  const appliedId = cfg?.general.activeProfileId ?? null;
  const { pending, run } = usePending({ exclusive: true });
  const [open, setOpen] = useState(false);
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
        if (ok) setOpen(false);
      });
    },
    [run],
  );

  const save = useCallback(
    (name: string) =>
      run(
        "scene-save",
        async () => {
          await api.sceneSave(name);
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

  const remove = useCallback(
    (scene: SceneProfile) => {
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

  const chooseLogo = useCallback(
    async (id: string) => {
      let file: string | null = null;
      await run(`pick-logo-${id}`, async () => {
        file = await api.pickImageFile();
      });
      if (!file) return false;
      return setLogo(id, file);
    },
    [run, setLogo],
  );

  const applied =
    appliedId != null && scenes.some((s) => s.id === appliedId) ? appliedId : null;
  const activeId = applied ?? (target ? activeConfigId(scenes, target) : null);
  const activeScene = activeId
    ? (scenes.find((s) => s.id === activeId) ?? null)
    : null;
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
    canDelete: canDeleteProfile(scenes.length),
    scenes,
    activeId,
    activeName,
    activeScene,
    applyingId: applyingConfigKey(pending),
  };
}
