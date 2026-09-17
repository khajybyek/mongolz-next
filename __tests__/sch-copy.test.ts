import { localizeEventText, schCopy } from "@/app/sch/sch-copy";
import { SCH_SEED_TEXT } from "@/lib/sch/schema";

describe("localizeEventText", () => {
  it("translates the seeded organiser texts for en and kr, keeps Mongolian as stored", () => {
    expect(localizeEventText(SCH_SEED_TEXT.title, "title", "en")).toBe(schCopy("en").eventTitle);
    expect(localizeEventText(SCH_SEED_TEXT.intro, "intro", "kr")).toBe(schCopy("kr").eventIntro);
    expect(localizeEventText(SCH_SEED_TEXT.payment, "payment", "en")).toBe(schCopy("en").eventPayment);
    expect(localizeEventText(SCH_SEED_TEXT.title, "title", "mn")).toBe(SCH_SEED_TEXT.title);
  });

  it("ignores whitespace differences introduced by editing or the database", () => {
    const spaced = SCH_SEED_TEXT.payment.replace(/\n/g, "\r\n") + "  ";
    expect(localizeEventText(spaced, "payment", "kr")).toBe(schCopy("kr").eventPayment);
  });

  it("shows organiser-edited text unchanged in every language and passes null through", () => {
    expect(localizeEventText("Тэмцээн 10/1-нд болно.", "intro", "en")).toBe("Тэмцээн 10/1-нд болно.");
    expect(localizeEventText(null, "intro", "en")).toBeNull();
    expect(localizeEventText(undefined, "title", "kr")).toBeNull();
  });

  it("keeps the bank account numbers identical across languages", () => {
    for (const lang of ["mn", "en", "kr"] as const) {
      const text = schCopy(lang).eventPayment;
      expect(text).toContain("1001-9949-6201");
      expect(text).toContain("450004000409071526");
    }
  });
});
