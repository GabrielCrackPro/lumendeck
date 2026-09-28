// "What's new": the release notes for the running build, plus history.
//
// Release notes used to live only on the GitHub release page, which a user
// who installed an update and relaunched would never think to visit. This is
// the same file the release pipeline publishes, bundled at build time.
import { useState } from "react";
import { useStore } from "../store";
import { truncateError } from "../utilities";
import { Card, Btn, Section } from "./ui";
import {
  CHANGELOG,
  currentRelease,
  olderReleases,
  releaseToMarkdown,
  type ChangelogEntry,
  type ChangelogRelease,
} from "@shared/changelog";

/** One bullet, with the commit scope carried through from the message. */
function Entry({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="flex gap-2 leading-relaxed">
      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[rgb(var(--glow)/0.7)]" />
      <span className="min-w-0 flex-1 text-[13px] text-[var(--text-dim)]">
        {entry.breaking && (
          <span className="mr-1.5 rounded bg-red-500/20 px-1.5 py-px font-mono text-[10px] font-semibold uppercase text-red-300">
            breaking
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

export default function WhatsNewCard() {
  const cfg = useStore((s) => s.cfg);
  const save = useStore((s) => s.save);
  const toast = useStore((s) => s.toast);
  const [copied, setCopied] = useState(false);

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

  const copy = async () => {
    if (!release) return;
    try {
      await navigator.clipboard.writeText(releaseToMarkdown(release));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast("ok", `Copied the v${version} notes.`);
    } catch (e) {
      toast("error", `Could not copy: ${truncateError(e)}`);
    }
  };

  return (
    <Card
      title="What's new"
      right={
        <span className="flex items-center gap-2">
          {unread && (
            <span className="rounded-full bg-[rgb(var(--glow)/0.18)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-[rgb(var(--glow))]">
              new
            </span>
          )}
          <span className="font-mono text-[10px] tracking-wide text-[var(--text-faint)]">
            v{version}
          </span>
        </span>
      }
    >
      {release ? (
        <>
          <div onFocusCapture={markRead} onMouseDown={markRead}>
            <ReleaseBody release={release} />
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
            <Btn size="sm" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy notes"}
            </Btn>
            {unread && (
              <Btn size="sm" variant="ghost" onClick={markRead}>
                Mark as read
              </Btn>
            )}
          </div>
        </>
      ) : (
        <p className="text-[13px] text-[var(--text-faint)]">
          No release notes are bundled for v{version}. Run{" "}
          <code className="font-mono text-xs">pnpm changelog</code> to
          regenerate CHANGELOG.md.
        </p>
      )}

      {history.length > 0 && (
        <div className="mt-2 border-t border-[var(--line)] pt-1">
          <Section
            title={`Earlier releases (${history.length})`}
            badge={
              <span className="font-mono text-[10px] text-[var(--text-faint)]">
                {CHANGELOG.length} total
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
    </Card>
  );
}
