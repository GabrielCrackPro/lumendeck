// The shortcuts card: this window's bindings and the global ones, drawn from
// the same table the "?" sheet renders. Extracted from OverviewTab.tsx.
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
  // This window's own keys, from the same table the "?" sheet renders, so the
  // card cannot advertise a binding the overlay does not have. Folded, because
  // five Ctrl+digit tab rows would push the global keys below the fold of a
  // 5-column card.
  const windowShortcuts = condenseWindowShortcuts(
    shortcutRows(),
    t("common.switch-tab"),
  );
  // The system-wide bindings, which the old card did not mention at all.
  const globalKeys = globalHotkeyState(
    hotkeys,
    hotkeysEnabled,
  );
  return (
        <Card
          title={t("common.shortcuts")}
          icon={<IconKeyboard />}
          className="xl:col-span-5"
        >
          {/* Two lists because they are two different things: these keys only
              work with this window focused, the ones below work from anywhere.
              The old card listed three prose strings and said nothing about the
              eleven global bindings the user had actually set. */}
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
          {globalKeys.boundCount === 0 ? (
            <p className="text-xs leading-relaxed text-[var(--text-faint)]">
              {t("common.no-global-hotkeys-yet-set-them-up")}
            </p>
          ) : (
            <>
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
              {/* The distinction the old card could not draw: stored bindings
                  that the master switch has released are not unbound, and
                  reporting them that way sends a user to rebind keys they
                  already bound. */}
              {globalKeys.dormant && (
                <p className="mt-2.5 text-[11px] leading-relaxed text-amber-300/90">
                  {t("common.keys-released-switch-off")}
                </p>
              )}
            </>
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
