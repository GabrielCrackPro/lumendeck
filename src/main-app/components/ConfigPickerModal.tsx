import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { ConfigAvatar } from "./ConfigAvatar";
import { Btn, Chip, EmptyState, ItemTitle, ICON_BTN, ICON_BTN_IDLE } from "./ui";
import { IconClose, IconImage, IconPencil, IconPlus, IconTrash, IconUser } from "./icons";
import { configName, isDuplicateConfigName, wallpaperSourceLabel } from "./configPicker";
import { t } from "../i18n";
import type { SceneProfile } from "@shared/types";

/**
 * One config in the list: apply it, or manage it.
 *
 * Managing is inline rather than behind a second dialog because every action
 * here is one field, and a dialog per field turns renaming a config into three
 * navigations. Applying is an explicit button rather than the whole row being
 * clickable, because the row now holds four other targets and a card-sized
 * click target behind them is a misclick waiting to happen.
 */
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
  // Which refusal, not just that there was one: a blank name and a name that is
  // already taken need different sentences, and reporting the duplicate for a
  // blank field says "there is already a config called ''".
  const [rejected, setRejected] = useState<"empty" | "duplicate" | null>(null);

  const startRename = () => {
    setDraft(scene.name);
    setRejected(null);
    setRenaming(true);
  };
  const commitRename = async () => {
    // The blank case is settled here rather than asked of the hook, purely so
    // the reason is known; the hook still refuses it either way.
    const blank = draft.trim().length === 0;
    if (!blank && (await onRename(scene.id, draft))) {
      setRenaming(false);
      return;
    }
    // Left open on refusal so the typed name stays visible and editable —
    // closing would throw away the evidence of what was wrong.
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
      {/* The avatar doubles as the image picker: one target for "this is what
          it looks like" and "change what it looks like". The component is the
          header's, not a second circle written here — the broken-image
          fallback is the fiddly part and it should only exist once. */}
      <ConfigAvatar
        scene={scene}
        size={36}
        onClick={() => void onChooseLogo(scene.id)}
        label={scene.logo ? t("common.replace-image") : t("common.set-image")}
        // The hover scrim, so the circle announces that it is the image control
        // rather than a picture you can only learn by clicking.
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
        {/* What the config actually holds. A name alone cannot tell "Work"
            from "Work, dimmed", and this is the row that decides which one
            gets applied. */}
        <div
          className="hint truncate"
          // The refusal replaces the summary line, so it has to be announced
          // rather than only redrawn — the name field stays open and focused.
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
        <button
          type="button"
          // Disabled rather than hidden: a button that disappears with no
          // explanation reads as a bug, and this one is available again the
          // moment a second profile exists.
          title={canDelete ? t("common.delete") : t("common.keep-one-profile")}
          aria-label={canDelete ? t("common.delete") : t("common.keep-one-profile")}
          disabled={!canDelete}
          className={`${ICON_BTN} ${ICON_BTN_IDLE}`}
          onClick={() => onDelete(scene)}
        >
          <IconTrash className="h-3.5 w-3.5" />
        </button>
        {isActive ? (
          // A word, not a colour: the tinted row and the accent glyph said the
          // same thing twice without ever saying it in text, and this is the
          // row a user is scanning for. Pops in when an apply lands.
          <span className="pop-on shrink-0">
            <Chip tone="accent">{t("common.applied")}</Chip>
          </span>
        ) : (
          <Btn
            // Contained rather than ghost: this row's whole point is switching
            // to it, and a text-only button reads as a secondary affordance
            // beside three icon buttons that are themselves boxed.
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

/**
 * The saved configs, as a dialog: pick one to switch to it, or capture what is
 * on screen right now as a new one.
 *
 * A dialog rather than a dropdown because this list is not a value. Choosing
 * from a select replaces the current value and the control keeps showing
 * whatever won, which is the wrong shape here: applying a config moves the
 * wallpaper and the stickers, and the thing worth seeing while deciding is the
 * list itself — what each entry holds, and which one is running. A dropdown
 * also cannot hold a text field, and saving has to live next to switching or
 * it is a second trip to Settings for a one-click action.
 *
 * Two modes rather than one long view. Naming something is not browsing: the
 * list is irrelevant while the cursor is in the name field, and it is eight
 * rows of distraction on a dialog with room for three. The save view is a
 * screen with a back arrow, so a user who meant to switch and landed here has
 * a way out that is not the same as closing.
 */
export function ConfigPickerModal({
  scenes,
  activeId,
  applyingId,
  /** Which view to open on. Settings' capture button asks for `save` directly. */
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
  /** The config the machine is running, or null when it is on nothing saved. */
  activeId: string | null;
  /** The config being applied right now, so its row can show the wait. */
  applyingId: string | null;
  startIn?: "browse" | "save";
  onApply: (id: string) => void;
  /** Resolves to whether the capture was written, not to a rejection. */
  onSave: (name: string) => Promise<boolean>;
  /** Resolves to whether the rename landed; false for blank or duplicate. */
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (scene: SceneProfile) => void;
  onChooseLogo: (id: string) => Promise<boolean>;
  onClearLogo: (id: string) => Promise<boolean>;
  /** False when this is the last profile, which cannot be deleted. */
  canDelete: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"browse" | "save">(startIn);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // Kept as the trimmed, fallback-resolved name so the error names the config
  // that would actually be created rather than what is in the field.
  const [duplicate, setDuplicate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // The dialog focuses its first control when it opens, which in the save view
  // is the back arrow. Refocused here so arriving by the arrow lands in the
  // field the whole view exists for, including on a mode switch rather than a
  // fresh mount.
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
      // Only cleared when the write landed. The failure surfaces as a toast
      // elsewhere, and wiping the field on the way out would make a retry mean
      // retyping the name the user just chose.
      if (await onSave(wanted)) {
        setName("");
        // Back to the list so the config just written is visible, which is the
        // only proof the capture worked.
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
      // Header, not a bar under the list: this dialog's own command, and only
      // where it leads somewhere new — in the save step the back arrow is the
      // way out and a second save control would only be a second way to lose
      // the name being typed.
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
          {/* The field's blank state names itself: configName falls back to a
              dated default, and a placeholder disappears the moment typing
              starts — so the actual name the save will get is stated here. */}
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
