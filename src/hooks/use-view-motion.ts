import { useLayoutEffect, useRef } from "react";
import { motionPreference, motionProfiles, reducedMotion } from "@/core/motion";
/** Animate the existing view without remounting editors or resetting focus/undo. */
export function useViewMotion(identity: string, selector: string) {
  const previous = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (previous.current === identity) return;
    previous.current = identity;
    const element = document.querySelector<HTMLElement>(selector);
    if (!element || !element.animate || reducedMotion()) return;
    const p = motionProfiles[motionPreference()];
    const animation = element.animate(
      [
        { opacity: 0, transform: `translateY(${p.distance}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: p.page, easing: "cubic-bezier(.2,.7,.25,1)", fill: "none" },
    );
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const cancel = () => {
      if (media?.matches) animation.cancel();
    };
    media?.addEventListener("change", cancel);
    return () => {
      animation.cancel();
      media?.removeEventListener("change", cancel);
    };
  }, [identity, selector]);
}
