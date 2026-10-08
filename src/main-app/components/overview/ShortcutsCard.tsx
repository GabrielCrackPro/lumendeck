import { Card, ComboCaps, MINI_BTN } from "../ui";
import { shortcutRows } from "../Sidebar";
import { condenseWindowShortcuts, globalHotkeyState } from "../overviewCards";
import { IconKeyboard } from "../icons";
import type { Config } from "@shared/types";
import { t } from "../../i18n";

export default function ShortcutsCard({
  hotkeys,
  hotkeysEnabled,
}: {
  hotkeys: Config["general"]["hotkeys"];
  hotkeysEnabled: boolean;
}) {
  const windowShortcuts = condenseWindowShortcuts(
    shortcutRows(),
    t("common.switch-tab"),
  );
  const globalKeys = globalHotkeyState(
    hotkeys,
    hotkeysEnabled,
  );
  return (
        <Card
          title={t("common.shortcuts")}
          icon={<IconKeyboard />}
          className="2xl:col-span-5"
        >

          <div className="kicker mb-1.5 text-[var(--text-faint)]">
            {t("common.this-window")}
          </div>
          <ul className="mb-4">
            {windowShortcuts.map((r) => (
              <li
                key={r.what}
                className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-1.5 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[13px] text-[var(--text-dim)]">
                  {r.what}
                </span>
                <ComboCaps keys={r.keys} />
              </li>
            ))}
          </ul>

          <div className="kicker mb-1.5 text-[var(--text-faint)]">
            {t("common.anywhere-on-your-pc")}
          </div>
          {!globalKeys.enabled && globalKeys.boundCount > 0 ? (
            <p className="text-xs leading-relaxed text-amber-300/90">
              {t("common.keys-released-switch-off")}
            </p>
          ) : globalKeys.boundCount === 0 ? (
            <p className="text-xs leading-relaxed text-[var(--text-faint)]">
              {t("common.no-global-hotkeys-yet-set-them-up")}
            </p>
          ) : (
            <ul>
              {globalKeys.bound.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--line)] py-1.5 last:border-b-0"
                >
                  <span className="min-w-0 truncate text-[13px] text-[var(--text-dim)]">
                    {t(r.labelKey)}
                  </span>
                  <ComboCaps keys={r.caps} />
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={() => window.dispatchEvent(new Event("lumendeck:open-shortcuts"))}
            className={`${MINI_BTN} mt-3.5`}
          >
            {t("common.view-all-shortcuts")}
          </button>
        </Card>
  );
}
