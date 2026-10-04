import { useEffect, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { IconUser } from "./icons";
import { avatarInitial } from "./avatarInit";
import { t } from "../i18n";
import type { SceneProfile } from "@shared/types";

/**
 * The current config as an avatar: the image the user chose, or their name's
 * first character.
 *
 * A circle rather than the chip this replaced, because an avatar reads as an
 * identity you switch between, and a labelled pill in a 52px header competes
 * with the tab name it sits beside. It lives in the header rather than next to
 * the greeting because it is a property of the machine, not of one screen —
 * moving to the Lighting tab should not make the config you are running
 * disappear.
 */
export function ConfigAvatar({
  scene,
  size = 32,
  onClick,
  label,
  live,
}: {
  /** The config currently applied, or null when the machine is on none. */
  scene: SceneProfile | null;
  size?: number;
  /**
   * Makes the avatar a button that opens the picker.
   *
   * Optional because it is not always an action: the Settings list shows the
   * same avatar purely as an identity mark, and a control that opens a dialog
   * there would be a second, hidden route into the picker. Without it the mark
   * renders as a span and is described to assistive tech rather than focusable.
   */
  onClick?: () => void;
  /**
   * Overrides the announced name. The header announces which config is running;
   * inside the picker the same circle is a button that changes the image, and
   * announcing "Config: Night" for that would name the wrong action.
   */
  label?: string;
  /**
   * Draws the status dot. Undefined draws none, which is what the list inside
   * Settings and the picker want: those are rows of saved setups, and a dot
   * there would claim something about a setup the machine is not running.
   */
  live?: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const logo = scene?.logo ?? null;
  // Reset when the logo changes, or a config whose image is missing would
  // poison the next one that loads fine.
  useEffect(() => setImageFailed(false), [logo]);

  const showImage = logo != null && !imageFailed;
  const initial = avatarInitial(scene?.name);
  const announced = label ?? configAvatarLabel(scene?.name ?? null);

  const frame = `relative flex shrink-0 items-center justify-center rounded-full border transition-all ${
    scene
      ? "border-[rgb(var(--glow)/0.5)] bg-[rgb(var(--glow)/0.12)]"
      : "border-[var(--line-strong)] bg-[var(--panel-strong)]"
  }`;

  // The mark itself, shared by both shells below.
  const inner = (
    <>
      {/* The clip lives on this inner span and not on the button. On the button
          it would cut the status dot into a sliver, because `overflow-hidden`
          follows the border radius and the dot sits in the corner the circle
          does not cover. */}
      <span className="block h-full w-full overflow-hidden rounded-full">
        {showImage ? (
          <img
            src={convertFileSrc(logo, "media")}
            alt=""
            // The file is a copy in our own media directory, so a failure means
            // it was deleted out from under us. The initial is the honest
            // fallback; a broken-image glyph in the header is not.
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

      {/* The dot sits on the avatar rather than beside it in the header. The
          words it replaced said "live" or "attention" in a 10px uppercase
          label, which is a sentence about the machine competing with the tab
          name for the same row. The tooltip keeps the state available to a
          pointer and to a screen reader while the header itself stays a mark
          you recognise rather than one you read. */}
      {live !== undefined && (
        <span
          title={t(live ? "overview.live" : "overview.attention")}
          className={`absolute -right-0.5 -bottom-0.5 block h-2.5 w-2.5 rounded-full ring-2 ring-[var(--panel-sunken)] ${
            live
              ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"
              : "bg-amber-400"
          }`}
        />
      )}
    </>
  );

  // Same mark, two roles. Only the actionable one is a button, so the Settings
  // list does not put an unnamed dialog trigger between the user and the
  // profile name.
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={announced}
      className={`${frame} hover-glow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.5)] active:scale-95`}
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

/** Label for the avatar button: the config running, or that there is none. */
export function configAvatarLabel(name: string | null): string {
  return name
    ? t("overview.profile-{name}", { name })
    : t("overview.no-profile-applied");
}
