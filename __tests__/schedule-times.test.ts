/**
 * Masking-schedule times: hours 24-29 used to pass the zod regex and the DB
 * CHECK, after which effective_mask_mode() raised 22008 on the ::time cast
 * and the page showed "masked" for that camera.
 */
const inserts: unknown[] = [];

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({ headers: async () => new Headers() }));
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

function fd(starts: string, ends: string) {
  const f = new FormData();
  f.set("camera_id", "b0000000-0000-4000-8000-000000000001");
  f.set("window_mode", "revealed");
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
    await expect(addScheduleAction(fd(starts, ends))).rejects.toThrow("HH:MM");
    expect(inserts).toHaveLength(0);
  },
);

it.each([["00:00", "23:59"], ["09:00", "24:00"], ["19:30", "07:15"]])("accepts %s–%s", async (starts, ends) => {
  await addScheduleAction(fd(starts, ends));
  expect(inserts[0]).toMatchObject({ starts_at: starts, ends_at: ends });
});
