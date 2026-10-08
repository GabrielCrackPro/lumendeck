import { useState } from "react";
import { api } from "../ipc";
import { usePending } from "../pending";
import { useStore } from "../store";
import { Btn } from "./ui";
import { IconClose, IconUpload } from "./icons";
import { truncateError } from "../utilities";
import { t } from "../i18n";
import type { Config, TransferPreview } from "@shared/types";

export default function TransferImport({
  onChanged,
  description,
  className,
}: {
  onChanged: (cfg: Config) => void;
  description?: string;
  className?: string;
}) {
  const { run } = usePending();
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
        {

 }
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