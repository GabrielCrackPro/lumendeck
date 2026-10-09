import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../../ipc";
import { t } from "../../i18n";
import { truncateError } from "../../utilities";
import { useStore } from "../../store";
import { Btn, EmptyState, InfoNote, Segmented, Toggle } from "../ui";
import { IconGear, IconImage, IconSearch } from "../icons";
import type { DiscoverItem, DiscoverSourceCfg } from "@shared/types";
import {
  DISCOVER_SOURCES,
  activeSources,
  canLoadMore,
  formatDuration,
  missingApiKey,
  sourceConfig,
  type DiscoverSourceId,
} from "./discoverSources";

const TILE =
  "group relative block overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] text-left transition-colors hover:border-[rgb(var(--glow)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-50";

const INPUT =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]";

function SettingInput({
  id,
  label,
  hint,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
    else setDraft(trimmed);
  };
  return (
    <div className="mt-1.5">
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-(--text-dim)"
      >
        {label}
      </label>
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className={INPUT}
      />
      {hint && (
        <p className="mt-1 text-[11px] leading-relaxed text-(--text-faint)">
          {hint}
        </p>
      )}
    </div>
  );
}

export function DiscoverPanel({
  onImport,
  onImported,
  disabled = false,
}: {
  onImport: (url: string, title: string) => Promise<boolean>;
  onImported: () => void;
  disabled?: boolean;
}) {
  const { cfg, save } = useStore(
    useShallow((s) => ({ cfg: s.cfg, save: s.save })),
  );
  const configured = cfg?.discover.sources;

  const sources = useMemo(() => activeSources(configured), [configured]);
  const [sourceId, setSourceId] = useState<DiscoverSourceId>("bing");
  const source = sources.find((s) => s.id === sourceId) ?? sources[0] ?? null;
  const sourceCfg = source ? sourceConfig(configured, source.id) : undefined;
  const needsKey = source ? missingApiKey(source, sourceCfg) : false;

  const [managing, setManaging] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<DiscoverItem[]>([]);
  const [lastPage, setLastPage] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const thumbs = useRef<Record<string, string>>({});
  const [, bumpThumbs] = useState(0);

  const epoch = useRef(0);

  const load = useCallback(async (src: string, q: string, p: number) => {
    const mine = epoch.current + 1;
    epoch.current = mine;
    setLoading(true);
    setError(null);
    try {
      const res = await api.discoverList(src, q, p);
      if (epoch.current !== mine) return;
      setItems((prev) => (p > 1 ? [...prev, ...res.items] : res.items));
      setLastPage(res.lastPage);
      setPage(p);
    } catch (e) {
      if (epoch.current !== mine) return;
      setError(truncateError(e));
    } finally {
      if (epoch.current === mine) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setQuery("");
    if (!source || needsKey) {
      epoch.current += 1;
      setItems([]);
      setLastPage(null);
      setPage(1);
      setLoading(false);
      setError(null);
      return;
    }
    void load(source.id, "", 1);
  }, [source?.id, needsKey, load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const item of items) {
        if (cancelled) return;
        if (thumbs.current[item.thumb]) continue;
        try {
          const dataUrl = await api.discoverThumb(item.thumb);
          if (cancelled || thumbs.current[item.thumb]) continue;
          thumbs.current[item.thumb] = dataUrl;
          bumpThumbs((n) => n + 1);
        } catch {
          // Keep the placeholder; importing works without the thumbnail.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  const patchSource = (id: string, patch: Partial<DiscoverSourceCfg>) => {
    void save((c) => {
      const list = c.discover.sources;
      const i = list.findIndex((s) => s.id === id);
      if (i >= 0) Object.assign(list[i]!, patch);
      else
        list.push({
          id,
          enabled: true,
          apiKey: "",
          defaultQuery: "",
          ...patch,
        });
    });
  };

  const search = (e: FormEvent) => {
    e.preventDefault();
    if (!source || needsKey) return;
    void load(source.id, query, 1);
  };

  const pick = async (item: DiscoverItem) => {
    if (disabled || importing) return;
    setImporting(item.id);
    try {
      const ok = await onImport(item.url, item.title);
      if (ok) onImported();
    } finally {
      setImporting(null);
    }
  };

  const searchLabel =
    sourceCfg?.defaultQuery.trim() || t("gallery.search-wallpapers");

  return (
    <div className="space-y-3 p-1">
      {managing && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <p className="max-w-md text-xs leading-relaxed text-(--text-faint)">
              {t("gallery.manage-sources-hint")}
            </p>
            <Btn variant="primary" size="sm" onClick={() => setManaging(false)}>
              {t("common.done")}
            </Btn>
          </div>
          <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-(--line) bg-(--panel-sunken) px-3">
            {DISCOVER_SOURCES.map((s) => {
              const sc = sourceConfig(configured, s.id);
              const on = sc?.enabled ?? true;
              const keyUrl = s.keyUrl;
              return (
                <div
                  key={s.id}
                  className="border-b border-(--line) py-2 last:border-b-0"
                >
                  <Toggle
                    checked={on}
                    label={t(s.label)}
                    description={t(s.hint)}
                    onChange={(v) => patchSource(s.id, { enabled: v })}
                  />
                  {on && s.needsKey && (
                    <SettingInput
                      id={`discover-key-${s.id}`}
                      label={t("gallery.api-key")}
                      hint={t("gallery.api-key-hint")}
                      value={sc?.apiKey ?? ""}
                      placeholder={t("gallery.api-key-placeholder")}
                      disabled={disabled}
                      onCommit={(v) => patchSource(s.id, { apiKey: v })}
                    />
                  )}
                  {on && s.searchable && (
                    <SettingInput
                      id={`discover-query-${s.id}`}
                      label={t("gallery.default-search")}
                      value={sc?.defaultQuery ?? ""}
                      placeholder={t("gallery.default-search-placeholder")}
                      disabled={disabled}
                      onCommit={(v) => patchSource(s.id, { defaultQuery: v })}
                    />
                  )}
                  {on && s.needsKey && keyUrl && (
                    <Btn
                      size="sm"
                      variant="ghost"
                      className="mt-1"
                      disabled={disabled}
                      onClick={() => void api.openUrl(keyUrl)}
                    >
                      {t("gallery.get-api-key")}
                    </Btn>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!managing && sources.length === 0 && (
        <EmptyState
          icon={<IconGear className="h-6 w-6" />}
          title={t("gallery.no-sources-enabled")}
          description={t("gallery.no-sources-enabled-hint")}
          action={
            <Btn variant="primary" onClick={() => setManaging(true)}>
              {t("gallery.manage-sources")}
            </Btn>
          }
        />
      )}

      {!managing && source && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label={t("gallery.discover-online")}
              className="min-w-56 flex-1"
              options={sources.map((s) => ({ id: s.id, label: t(s.label) }))}
              value={source.id}
              onChange={(v) => setSourceId(v)}
            />
            <Btn
              size="sm"
              variant="ghost"
              className="shrink-0"
              disabled={disabled}
              onClick={() => setManaging(true)}
            >
              <IconGear className="h-4 w-4" />
              {t("gallery.manage-sources")}
            </Btn>
          </div>

          {!needsKey && source.searchable && (
            <form onSubmit={search} className="flex gap-2">
              <input
                data-modal-autofocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchLabel}
                aria-label={searchLabel}
                className={INPUT}
              />
              <Btn
                type="submit"
                variant="primary"
                pending={loading}
                disabled={loading || disabled}
              >
                <IconSearch className="h-4 w-4" />
              </Btn>
            </form>
          )}

          <p className="text-xs leading-relaxed text-(--text-faint)">
            {t(source.hint)}
          </p>

          {needsKey && source.keyUrl && (
            <InfoNote tone="warn">
              <span className="block">{t("gallery.needs-key-note")}</span>
              <span className="mt-2 flex flex-wrap gap-2">
                <Btn
                  size="sm"
                  onClick={() => setManaging(true)}
                  disabled={disabled}
                >
                  {t("gallery.add-api-key")}
                </Btn>
                <Btn
                  size="sm"
                  variant="primary"
                  disabled={disabled}
                  onClick={() => void api.openUrl(source.keyUrl!)}
                >
                  {t("gallery.get-api-key")}
                </Btn>
              </span>
            </InfoNote>
          )}

          {error && <InfoNote tone="warn">{error}</InfoNote>}

          {!needsKey && !loading && !error && items.length === 0 && (
            <EmptyState
              icon={<IconImage className="h-6 w-6" />}
              title={t("gallery.no-wallpapers-found")}
            />
          )}

          {items.length > 0 && (
            <div className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3">
              {items.map((item) => {
                const thumb = thumbs.current[item.thumb];
                const clip = item.duration;
                const credit = item.attribution;
                return (
                  <button
                    key={`${item.source}:${item.id}`}
                    type="button"
                    onClick={() => void pick(item)}
                    disabled={disabled || importing !== null}
                    className={TILE}
                  >
                    <span className="relative block aspect-video w-full overflow-hidden bg-(--panel-sunken)">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-(--text-faint)">
                          <IconImage className="h-5 w-5" />
                        </span>
                      )}
                      {(credit || clip !== undefined) && (
                        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
                          {credit && (
                            <span className="truncate rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none text-white">
                              {credit}
                            </span>
                          )}
                          {clip !== undefined && (
                            <span className="shrink-0 rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none tabular-nums text-white">
                              {formatDuration(clip)}
                            </span>
                          )}
                        </span>
                      )}
                      {importing === item.id && (
                        <span className="absolute inset-0 flex items-center justify-center bg-(--panel-strong)/80">
                          <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--glow))] border-t-transparent" />
                        </span>
                      )}
                    </span>
                    <span className="block truncate px-2.5 py-1.5 text-[11px] leading-snug text-(--text-dim)">
                      {item.title}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {!needsKey && canLoadMore(lastPage, page) && (
            <div className="flex justify-center pt-0.5">
              <Btn
                onClick={() => void load(source.id, query, page + 1)}
                pending={loading}
                disabled={loading || disabled}
              >
                {t("gallery.load-more")}
              </Btn>
            </div>
          )}
        </>
      )}
    </div>
  );
}
