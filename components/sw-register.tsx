"use client";

import { useEffect } from "react";

/**
 * Register the PWA service worker (public/sw.js) on the first client paint.
 *
 * Production-only: in dev we'd churn the cache every reload. Mounted from
 * app/layout.tsx so it runs once globally.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;

    // Wait for the page to finish loading so we don't compete with critical
    // bundle requests.
    const onReady = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch(() => {
          // Silent fail — offline shell is non-critical.
        });
    };

    if (document.readyState === "complete") {
      onReady();
    } else {
      window.addEventListener("load", onReady, { once: true });
      return () => window.removeEventListener("load", onReady);
    }
  }, []);

  return null;
}
