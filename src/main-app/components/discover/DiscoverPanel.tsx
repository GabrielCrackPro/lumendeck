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
import { Btn, EmptyState, InfoNote, SHIMMER, SelectChip, SwitchBtn } from "../ui";
import { useCopy } from "../useCopy";
import {
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconClapperboard,
  IconClose,
  IconCopy,
  IconEye,
  IconEyeOff,
  IconFlame,
  IconGear,
  IconGlobe,
  IconImage,
  IconPlay,
  IconPlus,
  IconSearch,
  IconTelescope,
} from "../icons";
import { staggerDelay } from "../motion";
import type { DiscoverItem, DiscoverSourceCfg } from "@shared/types";
import {
  DISCOVER_SOURCES,
  activeSources,
  canLoadMore,
  formatDuration,
  formatResolution,
  missingApiKey,
  sourceConfig,
  type DiscoverSource,
  type DiscoverSourceId,
} from "./discoverSources";

const TILE =
  "group relative block overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] text-left transition-colors hover:border-[rgb(var(--glow)/0.5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--glow)/0.7)] disabled:cursor-not-allowed disabled:opacity-50";

const INPUT =
  "w-full rounded-lg border border-[var(--line)] bg-[var(--panel-strong)] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--text-faint)] focus:border-[rgb(var(--glow)/0.5)]";

const BADGE =
  "rounded bg-black/55 px-1 py-0.5 text-[10px] font-medium leading-none text-white";

const SOURCE_ICONS = {
  globe: IconGlobe,
  flame: IconFlame,
  telescope: IconTelescope,
  camera: IconCamera,
  play: IconPlay,
  clapperboard: IconClapperboard,
} as const;

function sourceIcon(source: DiscoverSource) {
  const Glyph = SOURCE_ICONS[source.icon];
  return <Glyph className="h-3.5 w-3.5" />;
}

function SettingInput({
  id,
  label,
  hint,
  value,
  placeholder,
  disabled,
  secret = false,
  revealed = false,
  onReveal,
  copyable = false,
  onCommit,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  secret?: boolean;
  revealed?: boolean;
  onReveal?: () => void;
  copyable?: boolean;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const { copy, justCopied } = useCopy();
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onCommit(trimmed);
    else setDraft(trimmed);
  };
  const pad = copyable ? "pr-20" : secret ? "pr-10" : "";
  return (
    <div className="mt-1.5">
      <label
        htmlFor={id}
        className="mb-1 block text-xs font-medium text-(--text-dim)"
      >
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={secret ? (revealed ? "text" : "password") : "text"}
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
          className={`${INPUT}${pad ? ` ${pad}` : ""}`}
        />
        {copyable && (
          <button
            type="button"
            onClick={() => void copy(draft.trim())}
            disabled={disabled || !draft.trim()}
            aria-label={t("gallery.copy-api-key")}
            className="absolute inset-y-0 right-9 flex w-9 items-center justify-center text-(--text-faint) transition-colors hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-40"
          >
            {justCopied ? (
              <IconCheck className="h-4 w-4 text-emerald-400" />
            ) : (
              <IconCopy className="h-4 w-4" />
            )}
          </button>
        )}
        {secret && (
          <button
            type="button"
            onClick={onReveal}
            disabled={disabled}
            aria-label={t(
              revealed ? "gallery.hide-api-key" : "gallery.show-api-key",
            )}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-(--text-faint) transition-colors hover:text-(--text) disabled:cursor-not-allowed"
          >
            {revealed ? (
              <IconEyeOff className="h-4 w-4" />
            ) : (
              <IconEye className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
      {hint && (
        <p className="mt-1 text-[11px] leading-relaxed text-(--text-faint)">
          {hint}
        </p>
      )}
    </div>
  );
}

function SourceRow({
  source,
  sc,
  disabled,
  patch,
}: {
  source: DiscoverSource;
  sc?: DiscoverSourceCfg;
  disabled: boolean;
  patch: (id: string, p: Partial<DiscoverSourceCfg>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const on = sc?.enabled ?? true;
  const keyUrl = source.keyUrl;
  const hasKeyField = Boolean(source.needsKey || source.optionalKey);
  const keyMissing = missingApiKey(source, sc);
  // A source with neither a key nor a search box has nothing to expand into.
  const hasSettings = hasKeyField || source.searchable;
  const labelBlock = (
    <span className="min-w-0">
      <span className="flex items-center gap-1.5 text-sm font-medium text-(--text)">
        <span className="text-(--text-faint)">{sourceIcon(source)}</span>
        {t(source.label)}
        {keyMissing && (
          <span
            aria-hidden="true"
            className="h-1.5 w-1.5 rounded-full bg-amber-400/80"
          />
        )}
      </span>
      <span className="mt-0.5 block truncate text-xs leading-relaxed text-(--text-faint)">
        {t(source.hint)}
      </span>
    </span>
  );
  return (
    <div className="border-b border-(--line) py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        {hasSettings ? (
          <button
            type="button"
            onClick={() => {
              setOpen((o) => !o);
              // A hidden field goes back to being masked.
              setRevealed(false);
            }}
            aria-expanded={open}
            aria-controls={`discover-settings-${source.id}`}
            className="flex min-w-0 flex-1 items-start gap-2 rounded-lg py-0.5 text-left focus-glow"
          >
            <IconChevronDown
              className={`disclose-chevron mt-0.5 h-4 w-4 shrink-0 text-(--text-faint) transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)] ${
                open ? "rotate-180" : ""
              }`}
            />
            {labelBlock}
          </button>
        ) : (
          <span className="flex min-w-0 flex-1 items-start gap-2 py-0.5">
            <span aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            {labelBlock}
          </span>
        )}
        <SwitchBtn
          checked={on}
          onChange={(v) => patch(source.id, { enabled: v })}
          title={t("gallery.enable-source-{name}", { name: t(source.label) })}
        />
      </div>
      {hasSettings && (
        <div
          className="disclose"
          data-open={open}
          inert={!open}
          id={`discover-settings-${source.id}`}
        >
          <div className="disclose-inner">
            <div className="pb-1 pl-6 pt-1">
              {hasKeyField && (
                <SettingInput
                  id={`discover-key-${source.id}`}
                  label={t("gallery.api-key")}
                  hint={
                    source.optionalKey
                      ? t("gallery.optional-key-hint")
                      : t("gallery.api-key-hint")
                  }
                  value={sc?.apiKey ?? ""}
                  placeholder={t("gallery.api-key-placeholder")}
                  disabled={disabled}
                  secret
                  revealed={revealed}
                  onReveal={() => setRevealed((r) => !r)}
                  copyable
                  onCommit={(v) => patch(source.id, { apiKey: v })}
                />
              )}
              {source.searchable && (
                <SettingInput
                  id={`discover-query-${source.id}`}
                  label={t("gallery.default-search")}
                  value={sc?.defaultQuery ?? ""}
                  placeholder={t("gallery.default-search-placeholder")}
                  disabled={disabled}
                  onCommit={(v) => patch(source.id, { defaultQuery: v })}
                />
              )}
              {hasKeyField && keyUrl && (
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
          </div>
        </div>
      )}
    </div>
  );
}

export function DiscoverPanel({
  onImport,
  onImported,
  disabled = false,
}: {
  onImport: (url: string, title: string, origin: string) => Promise<boolean>;
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
  // The parameters of the in-flight or last attempt, so an error can retry it.
  const lastAttempt = useRef({ src: "bing", q: "", p: 1 });

  const load = useCallback(async (src: string, q: string, p: number) => {
    lastAttempt.current = { src, q, p };
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

  const retry = useCallback(() => {
    const { src, q, p } = lastAttempt.current;
    void load(src, q, p);
  }, [load]);

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
    const queue = items.filter((item) => !thumbs.current[item.thumb]);
    void (async () => {
      // Small batches: one thumbnail at a time trickles in for seconds.
      const CONCURRENCY = 4;
      for (let i = 0; i < queue.length; i += CONCURRENCY) {
        if (cancelled) return;
        await Promise.all(
          queue.slice(i, i + CONCURRENCY).map(async (item) => {
            try {
              const dataUrl = await api.discoverThumb(item.thumb);
              if (cancelled || thumbs.current[item.thumb]) return;
              thumbs.current[item.thumb] = dataUrl;
              bumpThumbs((n) => n + 1);
            } catch {
              // Keep the placeholder; importing works without the thumbnail.
            }
          }),
        );
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
      const ok = await onImport(item.url, item.title, item.source);
      if (ok) {
        // Unsplash counts a download only after its `download_location` answers,
        // and the guidelines require that ping. It is bookkeeping, so a failure
        // is swallowed rather than reported as a failed import.
        if (item.downloadLocation) {
          void api.discoverPingDownload(item.downloadLocation).catch(() => {});
        }
        onImported();
      }
    } finally {
      setImporting(null);
    }
  };

  const searchLabel =
    sourceCfg?.defaultQuery.trim() || t("gallery.search-wallpapers");

  const firstPageLoading = loading && items.length === 0 && !error;

  // The grid scrolls inside its own box, so the sentinel is watched with that
  // box as the observer root rather than the window.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const autoLoading = useRef(false);
  const loadMore = useCallback(() => {
    if (needsKey || loading || disabled || autoLoading.current || !source) return;
    if (!canLoadMore(lastPage, page)) return;
    autoLoading.current = true;
    void load(source.id, query, page + 1).finally(() => {
      autoLoading.current = false;
    });
  }, [needsKey, loading, disabled, source, lastPage, page, query, load]);
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  }, [loadMore]);
  const gridMounted = items.length > 0;
  useEffect(() => {
    const node = sentinelRef.current;
    const root = gridRef.current;
    if (!node || !root) return;
    const io = new IntersectionObserver(
      () => void loadMoreRef.current(),
      { root, rootMargin: "200px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [gridMounted]);

  return (
    <div className="space-y-3 p-1">
      {!managing && (
        <div
          role="group"
          aria-label={t("gallery.discover-online")}
          className="flex flex-wrap items-center gap-1.5"
        >
          {sources.map((s) => {
            const keyMissing = missingApiKey(s, sourceConfig(configured, s.id));
            return (
              <SelectChip
                key={s.id}
                active={s.id === source?.id}
                disabled={disabled}
                title={keyMissing ? t("gallery.needs-key-note") : t(s.hint)}
                onClick={() => setSourceId(s.id)}
              >
                <span className="flex items-center gap-1.5">
                  {sourceIcon(s)}
                  {t(s.label)}
                  {keyMissing && (
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-amber-400/80"
                    />
                  )}
                </span>
              </SelectChip>
            );
          })}
          <span className="flex-1" />
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
      )}

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
            {DISCOVER_SOURCES.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                sc={sourceConfig(configured, s.id)}
                disabled={disabled}
                patch={patchSource}
              />
            ))}
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
          {source.searchable && !needsKey && (
            <form
              onSubmit={search}
              className="flex items-center gap-1.5 rounded-full border border-(--line) bg-(--panel-strong) py-1.5 pl-3 pr-1.5 transition-colors focus-within:border-[rgb(var(--glow)/0.5)]"
            >
              <IconSearch className="h-4 w-4 shrink-0 text-(--text-faint)" />
              <input
                data-modal-autofocus
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchLabel}
                aria-label={searchLabel}
                className="min-w-0 flex-1 bg-transparent text-sm text-(--text) outline-none placeholder:text-(--text-faint) [&::-webkit-search-cancel-button]:hidden"
              />
              {query !== "" && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    if (!loading) void load(source.id, "", 1);
                  }}
                  aria-label={t("gallery.clear-search")}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--text-faint) transition-colors hover:bg-(--panel) hover:text-(--text)"
                >
                  <IconClose className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="submit"
                aria-label={t("gallery.search-wallpapers")}
                disabled={loading || disabled}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--glow))] text-[var(--on-accent)] transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {loading ? (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <IconSearch className="h-3.5 w-3.5" />
                )}
              </button>
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

          {error && (
            <InfoNote tone="warn">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">{error}</span>
                <Btn size="sm" onClick={retry} disabled={loading}>
                  {t("gallery.retry-search")}
                </Btn>
              </span>
            </InfoNote>
          )}

          {firstPageLoading && (
            <div className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div
                  key={i}
                  aria-hidden="true"
                  className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]"
                >
                  <div className={`aspect-video w-full ${SHIMMER}`} />
                  <div className="px-2.5 py-2">
                    <div className={`h-3 w-2/3 rounded-sm ${SHIMMER}`} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!needsKey && !loading && !error && items.length === 0 && (
            <EmptyState
              icon={<IconImage className="h-6 w-6" />}
              title={t("gallery.no-wallpapers-found")}
            />
          )}

          {items.length > 0 && (
            <div
              ref={gridRef}
              className="grid max-h-[52vh] grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3"
            >
              {items.map((item, i) => {
                const thumb = thumbs.current[item.thumb];
                const clip = item.duration;
                const credit = item.attribution;
                const resolution = formatResolution(item.width, item.height);
                return (
                  <button
                    key={`${item.source}:${item.id}`}
                    type="button"
                    onClick={() => void pick(item)}
                    disabled={disabled || importing !== null}
                    style={{ animationDelay: `${staggerDelay(i)}ms` }}
                    className={`page-enter ${TILE}`}
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
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-opacity duration-[var(--motion-fast)] group-hover:bg-black/25 group-hover:opacity-100 group-focus-visible:opacity-100"
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-black/60 text-white backdrop-blur-sm">
                          <IconPlus className="h-4 w-4" />
                        </span>
                      </span>
                      {(credit || clip !== undefined || resolution) && (
                        <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 flex items-center justify-between gap-1">
                          <span className="flex min-w-0 items-center gap-1">
                            {credit && (
                              <span className={`truncate ${BADGE}`}>
                                {credit}
                              </span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            {resolution && (
                              <span
                                className={`${BADGE} font-mono tabular-nums`}
                              >
                                {resolution}
                              </span>
                            )}
                            {clip !== undefined && (
                              <span
                                className={`${BADGE} font-mono tabular-nums`}
                              >
                                {formatDuration(clip)}
                              </span>
                            )}
                          </span>
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
              {loading && (
                <>
                  {Array.from({ length: 3 }, (_, i) => (
                    <div
                      key={`more-${i}`}
                      aria-hidden="true"
                      className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)]"
                    >
                      <div className={`aspect-video w-full ${SHIMMER}`} />
                      <div className="px-2.5 py-2">
                        <div className={`h-3 w-2/3 rounded-sm ${SHIMMER}`} />
                      </div>
                    </div>
                  ))}
                </>
              )}
              <div
                ref={sentinelRef}
                aria-hidden="true"
                className="col-span-full h-px"
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
