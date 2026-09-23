/**
 * /sch share previews used to show the surveillance project (root layout's
 * og:title/description/image) with og:url https://aicctv.dev, because the
 * page set only title/description and Next replaces `openGraph` per segment
 * rather than merging it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { SCH_ORIGIN, schShareMetadata } from "@/lib/sch/metadata";

describe("schShareMetadata", () => {
  const meta = schShareMetadata({
    lang: "en",
    title: "SCH Esports · Chuseok 2026",
    description: "Registration for the Chuseok 2026 SCH Esports tournament",
    path: "/sch",
  });

  it("sets a complete SCH openGraph block on mongolz.dev", () => {
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "SCH Esports",
      title: "SCH Esports · Chuseok 2026",
      url: `${SCH_ORIGIN}/sch`,
      locale: "en_US",
    });
    expect(JSON.stringify(meta)).not.toMatch(/aicctv|MONGOLZ Security|Surveillance/i);
  });

  it("brings its own image so the root CCTV card is not inherited", () => {
    const og = meta.openGraph as { images: { url: string }[] };
    expect(og.images[0].url).toBe(`${SCH_ORIGIN}/sch/smis-logo.png`);
    expect(meta.twitter).toMatchObject({ card: "summary", images: [`${SCH_ORIGIN}/sch/smis-logo.png`] });
    // The image is a real static file, served without the auth middleware.
    const file = path.join(__dirname, "..", "public/sch/smis-logo.png");
    expect(readFileSync(file).subarray(1, 4).toString("ascii")).toBe("PNG");
  });

  it("keeps the page out of search and canonical to mongolz.dev", () => {
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates).toEqual({ canonical: `${SCH_ORIGIN}/sch` });
    expect(meta.title).toEqual({ absolute: "SCH Esports · Chuseok 2026" });
  });

  it("maps every UI language to an og locale", () => {
    for (const [lang, locale] of [["mn", "mn_MN"], ["kr", "ko_KR"]] as const) {
      const m = schShareMetadata({ lang, title: "t", description: "d", path: "/sch/teams" });
      expect(m.openGraph).toMatchObject({ locale, url: `${SCH_ORIGIN}/sch/teams` });
    }
  });
});
