// Turning a stored media reference into something an <img> can load.
//
// The backend is inconsistent about what it stores, and that inconsistency is
// the whole problem this file exists to absorb:
//
//   - Gallery entries and `wallpaper.source` hold a raw filesystem path
//     (`D:\Wallpapers\x.jpg`), because they are compared, bundled and
//     path-rewritten as paths.
//   - Sticker `url` holds an already-served `http://media.localhost/...` URL,
//     because the backend allow-lists and rewrites the file at placement time
//     and stores what it will actually serve.
//
// `convertFileSrc` only knows how to wrap a *path*: it is an unconditional
// `format!("{origin}/{percent_encode(path)}")` with no check for a value that
// is already a URL. Handed one, it produces
// `http://media.localhost/http%3A%2F%2Fmedia.localhost%2F...` -- a path that
// does not exist, which renders as a broken image rather than as an error.
//
// So the conversion is applied only to things that are actually paths, and a
// served URL is passed through untouched. Pure and tested, because the failure
// is a silently blank thumbnail rather than a thrown exception.

/** Whether a stored reference is already a servable URL rather than a path. */
export function isServedUrl(ref: string): boolean {
  return /^https?:\/\//i.test(ref);
}

/**
 * A media reference an element can load, whichever form it was stored in.
 *
 * `convert` is injected rather than imported so this stays a pure function --
 * the real `convertFileSrc` needs a Tauri IPC host, which does not exist under
 * vitest. Callers pass the real one; tests pass an identity function and assert
 * on what was and was not converted.
 */
export function toMediaSrc(ref: string, convert: (path: string) => string): string {
  // Blank is returned as-is rather than converted: handing an empty string to
  // the converter yields a URL for a directory root, which is a confusing way
  // to render "nothing selected".
  if (ref.length === 0) return ref;
  return isServedUrl(ref) ? ref : convert(ref);
}