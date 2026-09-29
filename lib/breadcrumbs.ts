import { findNavItem } from "@/lib/nav";
import { t, type Lang, type TranslationKey } from "@/lib/i18n/translations";

/**
 * Header breadcrumbs (components/app-header.tsx). The nav tree (lib/nav.ts)
 * names the top two levels; anything below a nav item is a route segment.
 *
 * - Static sub-route segments are translated through SEGMENT_LABELS, so
 *   /cameras/<id>/schedule reads "Хуваарь" / "Schedule" / "일정" instead of
 *   the raw word "schedule" (on phones the last crumb is the page title).
 * - Record ids (UUIDs) are shortened and never linked: /cameras/<id> has no
 *   page of its own, and a UUID in the middle of a path is only ever such a
 *   parent segment. A UUID as the LAST crumb is the current page, which is
 *   never a link anyway.
 */

export interface Crumb {
  label: string;
  href?: string;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Static sub-route segment → translation key. */
export const SEGMENT_LABELS: Record<string, TranslationKey> = {
  schedule: "schedule",
  permissions: "permissions",
  erase: "erase_title",
};

function decode(seg: string): string {
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

export function shortSegment(seg: string): string {
  const s = decode(seg);
  if (UUID_RE.test(s)) return s.slice(0, 8) + "…";
  return s.length > 22 ? s.slice(0, 20) + "…" : s;
}

function segmentLabel(seg: string, lang: Lang): string {
  const key = Object.prototype.hasOwnProperty.call(SEGMENT_LABELS, seg) ? SEGMENT_LABELS[seg] : undefined;
  return key ? t(key, lang) : shortSegment(seg);
}

function segmentCrumbs(base: string, segments: string[], lang: Lang): Crumb[] {
  return segments.map((seg, i) => ({
    label: segmentLabel(seg, lang),
    href: UUID_RE.test(decode(seg)) ? undefined : base + "/" + segments.slice(0, i + 1).join("/"),
  }));
}

export function buildCrumbs(pathname: string, lang: Lang): Crumb[] {
  const hit = findNavItem(pathname);
  if (!hit) {
    return segmentCrumbs("", pathname.split("/").filter(Boolean), lang);
  }
  const rest = pathname.slice(hit.item.href.length).split("/").filter(Boolean);
  return [
    { label: t(hit.group.labelKey, lang) },
    { label: t(hit.item.labelKey, lang), href: hit.item.href },
    ...segmentCrumbs(hit.item.href, rest, lang),
  ];
}
