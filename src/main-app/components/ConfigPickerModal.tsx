import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { ConfigAvatar } from "./ConfigAvatar";
import { Btn, EmptyState, ItemTitle, ICON_BTN, ICON_BTN_IDLE } from "./ui";
import { IconCheck, IconClose, IconImage, IconPencil, IconPlus, IconTrash, IconUser } from "./icons";
import { configName, isDuplicateConfigName, wallpaperSourceLabel } from "./configPicker";
import { t } from "../i18n";
import type { SceneProfile } from "@shared/types";

function ConfigRow({
  scene,
  isActive,
  isApplying,
  onApply,
  onRename,
  onDelete,
  onChooseLogo,
  onClearLogo,
  canDelete,
}: {
  scene: SceneProfile;
  isActive: boolean;
  isApplying: boolean;
  onApply: (id: string) => void;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (scene: SceneProfile) => void;
  onChooseLogo: (id: string) => Promise<boolean>;
  onClearLogo: (id: string) => Promise<boolean>;
  canDelete: boolean;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(scene.name);
  const [rejected, setRejected] = useState<"empty" | "duplicate" | null>(null);

  const startRename = () => {
    setDraft(scene.name);
    setRejected(null);
    setRenaming(true);
  };
  const commitRename = async () => {
    const blank = draft.trim().length === 0;
    if (!blank && (await onRename(scene.id, draft))) {
      setRenaming(false);
      return;
    }
    setRejected(blank ? "empty" : "duplicate");
  };

  return (
    <div
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left t-fast ${
        isActive
          ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.1)]"
          : "border-transparent hover:border-[var(--line)] hover:bg-[var(--panel-strong)]"
      }`}
    >

      <ConfigAvatar
        scene={scene}
        size={36}
        onClick={() => void onChooseLogo(scene.id)}
        label={scene.logo ? t("common.replace-image") : t("common.set-image")}
        overlay={<IconImage className="h-4 w-4" />}
      />

      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setRejected(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            aria-label={t("common.rename-profile")}
            aria-invalid={rejected != null || undefined}
            className={`w-full rounded-lg border bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--text)] outline-none transition-colors ${
              rejected
                ? "border-red-500/60 focus:border-red-500/80"
                : "border-[var(--line)] focus:border-[rgb(var(--glow)/0.5)]"
            }`}
          />
        ) : (
          <ItemTitle className="truncate">{scene.name}</ItemTitle>
        )}

        <div
          className="hint truncate"
          role={rejected ? "alert" : undefined}
        >
          {rejected === "empty"
            ? t("common.profile-name-empty")
            : rejected === "duplicate"
              ? t("common.profile-name-taken-{name}", { name: draft.trim() })
              : `${wallpaperSourceLabel(scene.wallpaper.source)} · ${
                  scene.rgb.enabled ? scene.rgb.mode : t("common.off")
                }${
                  scene.stickers.length > 0
                    ? ` · ${t("common.{n}-stickers", { n: scene.stickers.length })}`
                    : ""
                }`}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {scene.logo && (
          <button
            type="button"
            title={t("common.remove-image")}
            aria-label={t("common.remove-image")}
            className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
            onClick={() => void onClearLogo(scene.id)}
          >
            <IconClose className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          title={t("common.rename-profile")}
          aria-label={t("common.rename-profile")}
          className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
          onClick={startRename}
        >
          <IconPencil className="h-3.5 w-3.5" />
        </button>

        {canDelete && (
          <button
            type="button"
            title={t("common.delete")}
            aria-label={t("common.delete")}
            className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
            onClick={() => onDelete(scene)}
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        )}
        {isActive ? (
          <span
            className="pop-on flex h-7 w-7 items-center justify-center rounded-md text-[rgb(var(--glow))]"
            title={t("common.applied")}
          >
            <IconCheck className="h-4 w-4" />
          </span>
        ) : (
          <Btn
            variant="default"
            onClick={() => onApply(scene.id)}
            pending={isApplying}
            className="shrink-0"
          >
            {t("common.apply")}
          </Btn>
        )}
      </div>
    </div>
  );
}

export function ConfigPickerModal({
  scenes,
  activeId,
  applyingId,
  startIn = "browse",
  onApply,
  onSave,
  onRename,
  onDelete,
  onChooseLogo,
  onClearLogo,
  canDelete,
  onClose,
}: {
  scenes: readonly SceneProfile[];
  activeId: string | null;
  applyingId: string | null;
  startIn?: "browse" | "save";
  onApply: (id: string) => void;
  onSave: (name: string) => Promise<boolean>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (scene: SceneProfile) => void;
  onChooseLogo: (id: string) => Promise<boolean>;
  onClearLogo: (id: string) => Promise<boolean>;
  canDelete: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"browse" | "save">(startIn);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (mode === "save") inputRef.current?.focus();
  }, [mode]);

  const submit = async () => {
    const wanted = configName(
      name,
      t("common.profile-{date}", { date: new Date().toLocaleDateString() }),
    );
    if (isDuplicateConfigName(wanted, scenes.map((s) => s.name))) {
      setDuplicate(wanted);
      return;
    }
    setDuplicate(null);
    setSaving(true);
    try {
      if (await onSave(wanted)) {
        setName("");
        setMode("browse");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={t("common.profiles")}
      onClose={onClose}
      onBack={mode === "save" ? () => setMode("browse") : undefined}
      backLabel={t("common.back")}
      headerAction={
        mode === "browse" ? (
          <button
            type="button"
            onClick={() => setMode("save")}
            title={t("common.save-profile")}
            aria-label={t("common.save-profile")}
            className="shrink-0 rounded px-1.5 text-[var(--text-faint)] t-fast hover:text-[rgb(var(--glow))]"
          >
            <IconPlus className="h-4 w-4" />
          </button>
        ) : undefined
      }
    >
      {mode === "save" ? (
        <div className="body-enter p-2">
          <p className="mb-2.5 text-xs leading-relaxed text-[var(--text-dim)]">
            {t("common.capture-the-whole-look-wallpaper-per-monitor-ove")}
          </p>
          <input
            ref={inputRef}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDuplicate(null);
            }}
            onKeyDown={(e) => e.key === "Enter" && !saving && submit()}
            placeholder={t("common.name-this-look-e-g-night-gaming")}
            aria-invalid={duplicate != null || undefined}
            className="w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)] focus:outline-none"
          />

          {name.trim().length === 0 && duplicate == null && (
            <p className="hint mt-1.5">
              {t("common.leave-blank-to-use-{name}", {
                name: t("common.profile-{date}", {
                  date: new Date().toLocaleDateString(),
                }),
              })}
            </p>
          )}
          {duplicate && (
            <p role="alert" className="mt-1.5 text-xs text-red-400">
              {t("common.profile-name-taken-{name}", { name: duplicate })}
            </p>
          )}
          <div className="mt-3 flex items-center justify-end gap-2">
            <Btn variant="ghost" onClick={() => setMode("browse")}>
              {t("common.cancel")}
            </Btn>
            <Btn variant="primary" disabled={saving} onClick={submit}>
              {t(saving ? "common.saving" : "common.save")}
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex max-h-[26rem] flex-col gap-2">
          {scenes.length === 0 ? (
            <EmptyState
              icon={<IconUser className="h-6 w-6" />}
              title={t("common.no-configs-yet")}
              description={t("common.capture-the-whole-look-wallpaper-per-monitor-ove")}
            />
          ) : (
            <ul className="flex flex-col gap-1 overflow-y-auto body-enter">
              {scenes.map((s) => {
                const isActive = s.id === activeId;
                const isApplying = s.id === applyingId;
                return (
                  <li key={s.id}>
                    <ConfigRow
                      scene={s}
                      isActive={isActive}
                      isApplying={isApplying}
                      onApply={onApply}
                      onRename={onRename}
                      onDelete={onDelete}
                      onChooseLogo={onChooseLogo}
                      onClearLogo={onClearLogo}
                      canDelete={canDelete}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}
