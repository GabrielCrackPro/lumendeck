
export interface MediaMeta {
  width: number;
  height: number;
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

export function resetMediaMetaCache(): void {
  cache.clear();
  inflight.clear();
}

export function formatResolution(meta: MediaMeta | null): string | null {
  if (!meta) return null;
  return `${meta.width}x${meta.height}`;
}

export function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null;
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
