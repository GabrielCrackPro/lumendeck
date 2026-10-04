// Picking an export file and applying it, shared by Settings and onboarding.
//
// Both surfaces need the same three steps — pick, preview, confirm — and the
// middle one is the point. A config import replaces settings, the vault, the
// profiles and the stickers outright, so a button that wrote on click would be
// the most destructive control in the app wearing no warning. `transferPreview`
// is what lets both surfaces read the file first and say what it would do
// before offering to do it.
//
// The preview is therefore never skipped, and the staged panel replaces the
// button rather than appearing beside it: two ways to import on screen at once,
// one of them armed, is how the wrong one gets clicked.
import { useState } from "react";
import { api } from "../ipc";
import { usePending } from "../pending";
import { useStore } from "../store";
import { Btn } from "./ui";
import { IconClose, IconUpload } from "./icons";
import { truncateError } from "../utilities";
import { t } from "../i18n";
import type { Config, TransferPreview } from "@shared/types";

/**
 * The import half of a transfer card: pick a file, read it, confirm.
 *
 * `onChanged` receives the config read back after the import, never the one the
 * caller already had. The backend applies the import and its side effects; the
 * caller's only job is letting the UI catch up, and handing it a locally held
 * object instead would show the previous config's wallpaper for a frame.
 */
export default function TransferImport({
  onChanged,
  description,
  className,
}: {
  onChanged: (cfg: Config) => void;
  /** Optional line above the button. */
  description?: string;
  className?: string;
}) {
  const { run } = usePending();
  // The file the user picked, held between choosing it and confirming. Null
  // means nothing is staged, which is also the state after an import finishes.
  const [staged, setStaged] = useState<{
    path: string;
    preview: TransferPreview;
  } | null>(null);

  const chooseImport = () =>
    run(
      "transfer-pick",
      async () => {
        const path = await api.transferPickOpenPath();
        if (!path) return;
        // Preview before staging: a file that is not one of ours fails here,
        // with the reason, rather than at the point of overwriting anything.
        const preview = await api.transferPreview(path);
        setStaged({ path, preview });
      },
      (e) =>
        useStore
          .getState()
          .toast("error", t("settings.import-failed-{error}", { error: truncateError(e) })),
    );

  const confirmImport = () =>
    run(
      "transfer-import",
      async () => {
        if (!staged) return;
        const { path, preview } = staged;
        const n = await api.transferImport(path);
        onChanged(await api.getConfig());
        setStaged(null);
        useStore.getState().toast(
          "ok",
          preview.replacesEverything
            ? t("settings.imported-configuration")
            : t("settings.imported-{n}-profiles", { n }),
        );
      },
      (e) =>
        useStore
          .getState()
          .toast("error", t("settings.import-failed-{error}", { error: truncateError(e) })),
    );

  if (staged) {
    return (
      <div
        className={`rounded-xl border p-4 ${
          staged.preview.replacesEverything
            ? "border-amber-500/40 bg-amber-500/10"
            : "border-[var(--line)] bg-[var(--panel-strong)]"
        } ${className ?? ""}`}
      >
        <div className="text-sm font-semibold text-[var(--text)]">
          {t("settings.import-written-by", { version: staged.preview.fromVersion })}
        </div>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-dim)]">
          {staged.preview.replacesEverything
            ? t("settings.import-replaces-everything")
            : t("settings.import-adds-these-profiles", {
                names: staged.preview.profiles.join(", "),
              })}
        </p>
        {/* What the bundle carries, and what it could not. Both matter before a
            replace rather than after: a config import overwrites the vault, so
            a file that did not travel is not recoverable by importing again. */}
        {staged.preview.replacesEverything && (
          <p className="mt-2 text-xs leading-relaxed text-[var(--text-dim)]">
            {staged.preview.bundledMedia > 0
              ? t("settings.import-carries-{n}-media-files", {
                  n: staged.preview.bundledMedia,
                })
              : t("settings.import-carries-no-media-files")}
          </p>
        )}
        {staged.preview.missingMedia.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-amber-300/90">
            {t("settings.import-{n}-files-were-already-missing", {
              n: staged.preview.missingMedia.length,
            })}
          </p>
        )}
        <div className="mt-3 flex gap-2.5">
          <Btn variant="primary" onClick={confirmImport}>
            <IconUpload className="h-4 w-4" />
            {t("settings.import-confirm")}
          </Btn>
          <Btn variant="ghost" onClick={() => setStaged(null)}>
            <IconClose className="h-4 w-4" />
            {t("common.cancel")}
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {description && (
        <p className="mb-3 text-xs leading-relaxed text-[var(--text-faint)]">
          {description}
        </p>
      )}
      <Btn variant="ghost" onClick={chooseImport}>
        <IconUpload className="h-4 w-4" />
        {t("settings.import-from-file")}
      </Btn>
    </div>
  );
}