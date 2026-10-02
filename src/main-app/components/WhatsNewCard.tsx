// "What's new": the release notes for the running build, plus history.
//
// Release notes used to live only on the GitHub release page, which a user
// who installed an update and relaunched would never think to visit. This is
// the same file the release pipeline publishes, bundled at build time.
import { useStore } from "../store";
import { useCopy } from "./useCopy";
import { Card, Btn, Section, CollapsibleCard } from "./ui";
import { IconHistory } from "./icons";
import {
  CHANGELOG,
  currentRelease,
  olderReleases,
  releaseToMarkdown,
  type ChangelogEntry,
  type ChangelogRelease,
} from "@shared/changelog";
import { t } from "../i18n";

/** One bullet, with the commit scope carried through from the message. */
function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="flex gap-2 leading-relaxed">
      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[rgb(var(--glow)/0.7)]" />
      <span className="min-w-0 flex-1 text-[13px] text-[var(--text-dim)]">
        {entry.breaking && (
          <span className="mr-1.5 rounded bg-red-500/20 px-1.5 py-px font-mono text-[10px] font-semibold uppercase text-red-300">
            {t("changelog.breaking")}
          </span>
        )}
        {entry.scope && (
          <span className="font-mono text-[11px] text-[rgb(var(--glow))]">
            {entry.scope}:
          </span>
        )}{" "}
        {entry.text}
        {entry.hash && (
          <span className="ml-1.5 font-mono text-[10px] text-[var(--text-faint)]">
            {entry.hash}
          </span>
        )}
      </span>
    </li>
  );
}

function ReleaseBody({ release }: { release: ChangelogRelease }) {
  return (
    <>
      {release.note && (
        <p className="mb-3 text-[13px] leading-relaxed text-[var(--text-dim)]">
          {release.note}
        </p>
      )}
      {release.sections.map((section) =>
        section.entries.length === 0 ? null : (
          <div key={section.title} className="mb-3 last:mb-0">
            <div className="kicker mb-1.5">{section.title}</div>
            <ul className="space-y-1.5">
              {section.entries.map((entry, i) => (
                <Entry key={`${entry.hash ?? entry.text}-${i}`} entry={entry} />
              ))}
            </ul>
          </div>
        ),
      )}
    </>
  );
}

/**
 * Release notes for the running build.
 *
 * `compact` folds the body away behind a one-line summary, because this card
 * used to sit second on the settings page — above the theme picker — taking a
 * full screen of vertical space to announce a changelog nobody opened on
 * purpose. A release you have not read still opens itself, so "new" can never
 * be the thing that hides the news.
 */
export default function WhatsNewCard({ compact }: { compact?: boolean }) {
  const cfg = useStore((s) => s.cfg);
  const save = useStore((s) => s.save);

  const version = __APP_VERSION__;
  const release = currentRelease(version);
  const history = olderReleases(version);
  // Unread until the user opens this version's notes. Reading is recorded on
  // open rather than on click, so the marker means "you have seen this".
  const seen = cfg?.general.changelogSeenVersion;
  const unread = release != null && seen !== version;

  const markRead = () => {
    if (seen === version) return;
    void save((c) => (c.general.changelogSeenVersion = version));
  };

  const { copy, justCopied } = useCopy();
  const copyNotes = async () => {
    if (!release) return;
    await copy(
      releaseToMarkdown(release),
      t("changelog.copied-the-v{version}-notes", { version }),
    );
  };

  const changeCount =
    release?.sections.reduce((n, s) => n + s.entries.length, 0) ?? 0;

  const body = (
    <>
      {release ? (
        <>
          <div onFocusCapture={markRead} onMouseDown={markRead}>
            <ReleaseBody release={release} />
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
            <Btn size="sm" onClick={() => void copyNotes()}>
              {justCopied ? t("changelog.copied") : t("changelog.copy-notes")}
            </Btn>
            {unread && (
              <Btn size="sm" variant="ghost" onClick={markRead}>
                {t("changelog.mark-as-read")}
              </Btn>
            )}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-[var(--text-faint)]">
          {t("changelog.no-release-notes-are-bundled-for-v{version}-run", { version })}{" "}
          <code className="font-mono text-xs">pnpm changelog</code>{" "}
          {t("changelog.to-regenerate-changelog-md")}
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-2 border-t border-[var(--line)] pt-1">
          <Section
            title={t("changelog.earlier-releases-{n}", { n: history.length })}
            badge={
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {t("changelog.{n}-total", { n: CHANGELOG.length })}
              </span>
            }
          >
            <div className="space-y-4">
              {history.map((r) => (
                <div key={r.version}>
                  <div className="kicker mb-1.5">
                    v{r.version}
                    {r.date && (
                      <span className="ml-2 font-mono text-[10px] tracking-normal text-[var(--text-faint)]">
                        {r.date}
                      </span>
                    )}
                  </div>
                  <ReleaseBody release={r} />
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </>
  );

  if (compact) {
    return (
      <CollapsibleCard
        title={t("changelog.whats-new")}
        icon={<IconHistory />}
        defaultOpen={unread}
        summary={
          release ? (
            <span className="flex items-center gap-2">
              {unread && (
                <span className="rounded-full bg-[rgb(var(--glow)/0.18)] px-1.5 py-px font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--glow))]">
                  {t("changelog.new")}
                </span>
              )}
              <span className="truncate">
                {`v${version} — ${t("changelog.{n}-changes", { n: changeCount })}`}
              </span>
            </span>
          ) : (
            <span className="truncate">
              {`v${version} — ${t("changelog.no-bundled-notes")}`}
            </span>
          )
        }
      >
        {body}
      </CollapsibleCard>
    );
  }

  return (
    <Card
      title={t("changelog.whats-new")}
      icon={<IconHistory />}
      right={
        <span className="flex items-center gap-2">
          {unread && (
            <span className="rounded-full bg-[rgb(var(--glow)/0.18)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--glow))]">
              {t("changelog.new")}
            </span>
          )}
          <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
            v{version}
          </span>
        </span>
      }
    >
      {body}
    </Card>
  );
}
