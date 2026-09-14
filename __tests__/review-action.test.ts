import { reviewFaceAction } from "@/app/(app)/review/actions";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/auth";

const FACE = "11111111-2222-4333-8444-555555555555";
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("@/lib/supabase/auth", () => ({ requireAdmin: jest.fn(async () => ({ user: { id: "admin" } })) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

beforeEach(() => { jest.clearAllMocks(); rpc.mockReset(); });

test("review commits via one caller-authenticated atomic update/audit RPC", async () => {
  rpc.mockResolvedValue({ data: FACE, error: null });
  expect(await reviewFaceAction(FACE, "uncertain")).toEqual({ ok: true });
  expect(requireAdmin).toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith("review_face", { p_face_id: FACE, p_label: "uncertain" });
  expect(revalidatePath).toHaveBeenCalledWith("/review");
});
test("another operator's prior review is reported as a conflict", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "P0002" } });
  expect(await reviewFaceAction(FACE, "confirmed")).toEqual({ error: "conflict" });
  expect(revalidatePath).not.toHaveBeenCalled();
});
test.each([
  { data: null, error: { code: "42501" } },
  { data: null, error: { code: "08006" } },
  { data: null, error: null },
  { data: "different-face", error: null },
])("refused/failed/missing-row update cannot announce successful review", async (reply) => {
  rpc.mockResolvedValue(reply);
  expect(await reviewFaceAction(FACE, "rejected")).toEqual({ error: "unavailable" });
  expect(revalidatePath).not.toHaveBeenCalled();
});
test("invalid targets are not submitted", async () => {
  expect(await reviewFaceAction("no-such-face", "confirmed")).toEqual({ error: "invalid" });
  expect(rpc).not.toHaveBeenCalled();
});
test("transport failure remains retryable instead of an unhandled successful toast", async () => {
  rpc.mockRejectedValue(new Error("connection reset"));
  expect(await reviewFaceAction(FACE, "confirmed")).toEqual({ error: "unavailable" });
});
