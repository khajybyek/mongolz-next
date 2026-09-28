/**
 * Privacy-schedule times: hours 24-29 used to pass the zod regex and the DB
 * CHECK, after which the schedule evaluator raised 22008 on the ::time cast
 * and the page showed the wrong mode for that camera. 24:00 is a valid END
 * only, and a window must not start and end at the same minute (ADR 0012).
 *
 * Private windows are used here because adding one is tightening (no step-up).
 */
const inserts: unknown[] = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "mongolz-lang" ? { value: "en" } : undefined) }),
}));
jest.mock("@/lib/notify", () => ({ scheduleSecurityEvent: jest.fn() }));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: async () => ({ user: { id: "admin-1", email: "a@x.test" }, profile: { role: "admin" } }),
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        inserts.push(row);
        return { error: null };
      },
    }),
  }),
}));

import { addScheduleAction } from "@/app/(app)/cameras/[id]/schedule/actions";
import { T } from "@/lib/i18n/translations";

function fd(starts: string, ends: string) {
  const f = new FormData();
  f.set("camera_id", "b0000000-0000-4000-8000-000000000001");
  f.set("window_mode", "private");
  f.set("starts_at", starts);
  f.set("ends_at", ends);
  f.set("weekdays", "127");
  return f;
}

beforeEach(() => {
  inserts.length = 0;
});

it.each([["24:30", "18:00"], ["29:00", "18:00"], ["09:00", "25:00"], ["9:00", "18:00"], ["09:60", "18:00"]])(
  "rejects %s–%s",
  async (starts, ends) => {
    expect(await addScheduleAction(fd(starts, ends))).toEqual({ error: T.schedule_err_time_format.en });
    expect(inserts).toHaveLength(0);
  },
);

it("rejects a window that starts at 24:00", async () => {
  expect(await addScheduleAction(fd("24:00", "06:00"))).toEqual({ error: T.schedule_err_start_24.en });
  expect(inserts).toHaveLength(0);
});

it("rejects a window whose start equals its end", async () => {
  expect(await addScheduleAction(fd("09:00", "09:00"))).toEqual({ error: T.schedule_err_same_time.en });
  expect(inserts).toHaveLength(0);
});

it.each([["00:00", "23:59"], ["09:00", "24:00"], ["19:30", "07:15"], ["00:00", "24:00"]])(
  "accepts %s–%s",
  async (starts, ends) => {
    expect(await addScheduleAction(fd(starts, ends))).toEqual({ ok: true });
    expect(inserts[0]).toMatchObject({ starts_at: starts, ends_at: ends, window_mode: "private" });
  },
);
