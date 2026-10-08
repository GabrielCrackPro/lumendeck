import { useEffect, useState, type ReactNode } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IconUser } from "./icons";
import { avatarInitial } from "./avatarInit";
import { t } from "../i18n";
import type { SceneProfile } from "@shared/types";

export function ConfigAvatar({
  scene,
  size = 32,
  onClick,
  label,
  live,
  overlay,
}: {
  scene: SceneProfile | null;
  size?: number;
  onClick?: () => void;
  label?: string;
  live?: boolean;
  overlay?: ReactNode;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const logo = scene?.logo ?? null;
  useEffect(() => setImageFailed(false), [logo]);

  const showImage = logo != null && !imageFailed;
  const initial = avatarInitial(scene?.name);
  const announced = label ?? configAvatarLabel(scene?.name ?? null);

  const frame = `relative flex shrink-0 items-center justify-center rounded-full border transition-all ${
    scene
      ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)]"
      : "border-[var(--line-strong)] bg-[var(--panel-strong)]"
  }`;

  const inner = (
    <>
      {


 }
      <span className="block h-full w-full overflow-hidden rounded-full">
        {showImage ? (
          <img
            src={convertFileSrc(logo, "media")}
            alt=""
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-semibold leading-none text-[rgb(var(--glow))]"
            style={{ fontSize: Math.round(size * 0.42) }}
          >
            {initial || <IconUser className="h-1/2 w-1/2" />}
          </span>
        )}
      </span>

      {



 }
      {overlay && onClick && (
        <span className="t-fast pointer-events-none absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 group-hover/av:opacity-100 group-focus-visible/av:opacity-100">
          {overlay}
        </span>
      )}

      {




 }
      {live !== undefined && (
        <span
          title={t(live ? "overview.live" : "overview.attention")}
          className={`absolute -right-0.5 -bottom-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-[var(--panel-sunken)] ${
            live
              ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)] pulse-base"
              : "bg-amber-400"
          }`}
        />
      )}
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={announced}
      className={`${frame} group/av hover-glow focus-glow active:scale-95`}
      style={{ width: size, height: size }}
    >
      {inner}
    </button>
  ) : (
    <span aria-hidden="true" className={frame} style={{ width: size, height: size }}>
      {inner}
    </span>
  );
}

export function configAvatarLabel(name: string | null): string {
  return name
    ? t("overview.profile-{name}", { name })
    : t("overview.no-profile-applied");
}
