import type { Metadata } from "next";
import type { Lang } from "@/lib/i18n/translations";

/** The registration link handed to players lives on this host. */
export const SCH_ORIGIN = "https://mongolz.dev";

const OG_LOCALE: Record<Lang, string> = { mn: "mn_MN", en: "en_US", kr: "ko_KR" };

/**
 * Share metadata for the public SCH pages. Next replaces `openGraph` and
 * `twitter` wholesale per segment, so leaving either out made /sch inherit
 * the root layout's surveillance-project card, title and `og:url`
 * (https://aicctv.dev) in every chat preview. The image is the public SMIS
 * mark (a static file, so the auth middleware never sees the request).
 */
export function schShareMetadata(opts: {
  lang: Lang;
  title: string;
  description: string;
  /** Path on SCH_ORIGIN, e.g. "/sch". */
  path: "/sch" | "/sch/teams";
}): Metadata {
  const url = `${SCH_ORIGIN}${opts.path}`;
  const image = { url: `${SCH_ORIGIN}/sch/smis-logo.png`, width: 512, height: 512, alt: "SCH Esports" };
  return {
    title: { absolute: opts.title },
    description: opts.description,
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      siteName: "SCH Esports",
      title: opts.title,
      description: opts.description,
      url,
      locale: OG_LOCALE[opts.lang],
      alternateLocale: Object.values(OG_LOCALE).filter((l) => l !== OG_LOCALE[opts.lang]),
      images: [image],
    },
    twitter: {
      card: "summary",
      title: opts.title,
      description: opts.description,
      images: [image.url],
    },
  };
}
