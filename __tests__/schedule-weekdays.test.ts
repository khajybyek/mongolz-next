/**
 * Privacy-schedule weekdays (ADR 0012). The add-window form used to take the
 * raw bitmask (Sun = 1 … Sat = 64) as a number the admin summed by hand, so
 * typing 63 instead of 62 silently added Sunday to a window. It is now seven
 * day checkboxes; the action ORs the ticked bits into the same mask, and a
 * submission with no day (or a value that is not a day bit) is refused.
 *
 * Private windows are used because adding one is tightening (no step-up).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const inserts: Array<Record<string, unknown>> = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "mongolz-lang" ? { value: "en" } : undefined) }),
}));
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/lib/notify", () => ({ scheduleSecurityEvent: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin-1", email: "a@x.test" }, profile: { role: "admin" } }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { addScheduleAction } from "@/app/(app)/cameras/[id]/schedule/actions";
import {
  WEEKDAY_BITS,
  WEEKDAY_FIELD,
  weekdaysFromForm,
  weekdaysLabel,
} from "@/app/(app)/cameras/[id]/schedule/weekdays";
import { StepUpForm } from "@/components/step-up-form";
import { LangProvider } from "@/lib/i18n/client";
import { T } from "@/lib/i18n/translations";

function form(bits: string[], extra: Record<string, string> = {}) {
  const f = new FormData();
  f.set("camera_id", "b0000000-0000-4000-8000-000000000001");
  f.set("window_mode", "private");
  f.set("starts_at", "09:00");
  f.set("ends_at", "18:00");
  for (const b of bits) f.append(WEEKDAY_FIELD, b);
  for (const [k, v] of Object.entries(extra)) f.set(k, v);
  return f;
}

beforeEach(() => {
  inserts.length = 0;
});

describe("weekdaysFromForm", () => {
  it("ORs the ticked day bits into the mask", () => {
    expect(weekdaysFromForm(form(["2", "4", "8", "16", "32"]))).toBe(62);
    expect(weekdaysFromForm(form(["1", "64"]))).toBe(65);
    expect(weekdaysFromForm(form(WEEKDAY_BITS.map(String)))).toBe(127);
  });

  it("counts a repeated day once", () => {
    expect(weekdaysFromForm(form(["2", "2", "4"]))).toBe(6);
  });

  it.each([["3"], ["0"], ["128"], ["-2"], ["2.0"], ["x"], [""]])("refuses the non-day value %p", (v) => {
    expect(weekdaysFromForm(form(["2", v]))).toBeNaN();
  });

  it("is 0 (never every day) when no day is ticked", () => {
    expect(weekdaysFromForm(form([]))).toBe(0);
  });

  it("still reads the numeric weekdays field of a form without checkboxes", () => {
    expect(weekdaysFromForm(form([], { weekdays: "62" }))).toBe("62");
  });
});

describe("addScheduleAction with day checkboxes", () => {
  it("stores the same bitmask the numeric field did", async () => {
    expect(await addScheduleAction(form(["2", "4", "8", "16", "32"]))).toEqual({ ok: true });
    expect(inserts[0]).toMatchObject({ weekdays: 62, window_mode: "private" });
  });

  it("refuses a window with no day ticked, in the operator's language", async () => {
    expect(await addScheduleAction(form([]))).toEqual({ error: T.schedule_err_weekdays.en });
    expect(inserts).toHaveLength(0);
  });

  it("refuses a tampered day value", async () => {
    expect(await addScheduleAction(form(["2", "3"]))).toEqual({ error: T.schedule_err_weekdays.en });
    expect(inserts).toHaveLength(0);
  });
});

describe("weekdaysLabel", () => {
  it("names the days in the table", () => {
    expect(weekdaysLabel(127, "en")).toBe("Every day");
    expect(weekdaysLabel(65, "en")).toBe("Sun, Sat");
    expect(weekdaysLabel(62, "kr")).toBe("월, 화, 수, 목, 금");
    expect(weekdaysLabel(1, "xx")).toBe("Ня");
  });

  it("folds runs of three or more days only when asked (the phone table cell)", () => {
    expect(weekdaysLabel(62, "en", { ranges: true })).toBe("Mon–Fri");
    expect(weekdaysLabel(62, "mn", { ranges: true })).toBe("Да–Ба");
    expect(weekdaysLabel(62, "kr", { ranges: true })).toBe("월–금");
    // Two adjacent days stay a list; separate runs fold on their own.
    expect(weekdaysLabel(6, "en", { ranges: true })).toBe("Mon, Tue");
    expect(weekdaysLabel(1 | 2 | 4 | 16 | 32, "en", { ranges: true })).toBe("Sun–Tue, Thu, Fri");
    expect(weekdaysLabel(65, "en", { ranges: true })).toBe("Sun, Sat");
    expect(weekdaysLabel(127, "en", { ranges: true })).toBe("Every day");
    // Without the option the full list is kept (aria-label of the delete button).
    expect(weekdaysLabel(62, "en")).toBe("Mon, Tue, Wed, Thu, Fri");
  });
});

describe("schedule page form", () => {
  const page = readFileSync(join(__dirname, "..", "app", "(app)", "cameras", "[id]", "schedule", "page.tsx"), "utf8");

  it("offers day checkboxes instead of a bitmask number", () => {
    expect(page).toContain("name={WEEKDAY_FIELD}");
    expect(page).not.toContain('name="weekdays"');
  });

  it("shows the default mode as wrap-friendly radios that revert when not saved", () => {
    expect(page).toMatch(/type="radio"\s+name="privacy_default"/);
    expect(page).not.toMatch(/<select[^>]*name="privacy_default"/);
    expect(page).toMatch(/action=\{setPrivacyDefaultAction\}[\s\S]{0,80}revertUnsaved/);
    expect(page).toMatch(/action=\{addScheduleAction\}[\s\S]{0,80}resetOnSuccess/);
  });
});

describe("StepUpForm markup", () => {
  it("keeps the caller's layout classes on the box that holds the fields", () => {
    const html = renderToStaticMarkup(
      createElement(LangProvider, {
        initial: "en",
        children: createElement(StepUpForm, {
          action: async () => ({ ok: true as const }),
          className: "card space-y-3",
          children: createElement("button", { type: "submit" }, "Save"),
        }),
      }),
    );
    // The fieldset (disabled while the action runs) carries the classes, so
    // `space-y-*` still spaces the fields. The form is a real box (one-cell
    // grid): a parent's `space-y-*` margin needs a box to land on — with
    // `display: contents` it was dropped and neighbouring cards touched.
    expect(html).toMatch(/^<form class="grid"><fieldset[^>]*class="min-w-0 card space-y-3"[^>]*><button type="submit">Save<\/button><\/fieldset><\/form>$/);
    expect(html).not.toContain('class="contents"');
  });
});
