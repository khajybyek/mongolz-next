"use client";

import { useEffect } from "react";
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from "web-vitals";

function getOrCreateSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  const KEY = "mongolz-vital-sid";
  try {
    const cur = sessionStorage.getItem(KEY);
    if (cur && cur.length >= 8) return cur;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

function buildSample(metric: Metric, pagePath: string, sessionId: string) {
  return {
    session_id: sessionId,
    metric: metric.name,
    value: Math.round(metric.value * 1000) / 1000,
    rating: metric.rating,
    page: pagePath,
    navigation_type: metric.navigationType,
  };
}

function send(payload: object[] | object) {
  const data = JSON.stringify(payload);
  const url = "/api/vitals";
  try {
    if (navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([data], { type: "application/json" }));
      if (ok) return;
    }
  } catch {
    /* fallthrough to fetch */
  }
  fetch(url, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: data,
  }).catch(() => undefined);
}

export function VitalsReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const sid = getOrCreateSessionId();
    const path = typeof location !== "undefined" ? location.pathname : "/";
    const dispatch = (m: Metric) => send(buildSample(m, path, sid));
    onLCP(dispatch);
    onINP(dispatch);
    onCLS(dispatch);
    onFCP(dispatch);
    onTTFB(dispatch);
  }, []);
  return null;
}
