import { useEffect, useRef, useState } from "react";

/**
 * Reports when an element is close to the viewport.
 *
 * Vault tiles mount a <video> that eagerly decodes a frame, and the metadata
 * probe issues a range request, so a vault of a few hundred wallpapers would
 * otherwise do a few hundred of both the moment the tab opens. Once true it
 * stays true: the work is done and there is nothing to undo.
 */
export function useNearViewport<T extends HTMLElement>(rootMargin = "240px") {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, rootMargin]);
  return { ref, near };
}
