"use client";

import { useEffect } from "react";

export const SCH_HEADER_VAR = "--sch-header-h";

/**
 * Publishes the sticky header's real height as a CSS variable on `<html>`.
 *
 * On phones the public header wraps into three rows (logo, controls, nav)
 * and grows to ~190 px, so a fixed `scroll-margin-top` leaves the target of
 * an in-page anchor (`#sch-form`) hidden underneath it. Anything that
 * scrolls to an anchor inside `/sch` uses
 * `calc(var(--sch-header-h, 4.5rem) + …)` instead. The fallback keeps the
 * pre-JS / reduced-JS behaviour identical to the rest of the site.
 */
export function HeaderOffset({ headerId }: { headerId: string }) {
  useEffect(() => {
    const header = document.getElementById(headerId);
    if (!header) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty(SCH_HEADER_VAR, `${Math.ceil(header.getBoundingClientRect().height)}px`);
    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => {
        window.removeEventListener("resize", publish);
        root.style.removeProperty(SCH_HEADER_VAR);
      };
    }
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty(SCH_HEADER_VAR);
    };
  }, [headerId]);
  return null;
}
