// Resolution and duration for vault entries.
//
// The backend only stores a thumbnail, so this asks the browser: an <img>
// knows its own natural size, a <video> knows its duration from a metadata
// fetch that does not decode a frame. Both are cached per source, because a
// grid re-renders often and re-probing every tile on each render would mean a
// few hundred range requests while scrolling.
//
// Anything unprobeable — a web wallpaper, a file that has been moved, a codec
// the browser cannot read — resolves to `null` and the card simply omits the
// fact. Guessing would be worse than saying nothing.

export interface MediaMeta {
  width: number;
  height: number;
  /** Seconds, for video only. */
  duration: number | null;
}

const cache = new Map<string, MediaMeta | null>();
const inflight = new Map<string, Promise<MediaMeta | null>>();

function probeImage(url: string): Promise<MediaMeta | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () =>
      resolve(
        img.naturalWidth && img.naturalHeight
          ? { width: img.naturalWidth, height: img.naturalHeight, duration: null }
          : null,
      );
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function probeVideo(url: string): Promise<MediaMeta | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    // "metadata" is the whole point: enough to learn duration and dimensions
    // without pulling in the file body.
    video.preload = "metadata";
    video.muted = true;
    const done = (v: MediaMeta | null) => {
      video.removeAttribute("src");
      video.load();
      resolve(v);
    };
    video.onloadedmetadata = () =>
      done(
        video.videoWidth && video.videoHeight
          ? {
              width: video.videoWidth,
              height: video.videoHeight,
              duration: Number.isFinite(video.duration) ? video.duration : null,
            }
          : null,
      );
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * Probe one entry, memoised on the url.
 *
 * The caller passes a url it can already load — a local path through
 * `convertFileSrc`, or a remote one as-is — so this module stays free of the
 * Tauri bridge and testable in plain node.
 */
export function mediaMeta(
  url: string,
  kind: "video" | "image" | "slideshow" | "web" | "shader",
): Promise<MediaMeta | null> {
  if (kind === "web" || kind === "shader") return Promise.resolve(null);
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  const already = inflight.get(url);
  if (already) return already;

  const p = (kind === "video" || kind === "slideshow"
    ? probeVideo(url)
    : probeImage(url)
  )
    .then((meta) => {
      cache.set(url, meta);
      inflight.delete(url);
      return meta;
    })
    .catch(() => {
      cache.set(url, null);
      inflight.delete(url);
      return null;
    });
  inflight.set(url, p);
  return p;
}

/** Test seam: forget everything probed so far. */
export function resetMediaMetaCache(): void {
  cache.clear();
  inflight.clear();
}

/** "1920x1080" — omitted when the dimensions are unknown. */
export function formatResolution(meta: MediaMeta | null): string | null {
  if (!meta) return null;
  return `${meta.width}x${meta.height}`;
}

/**
 * "1:24" or "0:07". Null when the duration is unknown — zero is a real value
 * for a still frame, so it must not be hidden.
 */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
