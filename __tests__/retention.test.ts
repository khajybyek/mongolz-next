import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.generated";
import { runRetentionSweep } from "@/lib/retention";

type Item = { id: string; bucket: string; object_path: string; lease_token: string };
const item = (id: string, bucket = "revealed"): Item => ({
  id, bucket, object_path: `${id}.mp4`, lease_token: "lease-1",
});

function mockClient(batches: Item[][], remove = jest.fn(async (paths: string[]) => ({
  data: paths.map((name) => ({ name })), error: null as { message: string } | null,
}))) {
  const rpc = jest.fn(async (name: string, args?: { p_ids: string[] }) => {
    if (name === "sweep_retention") return { data: { reveal_outputs: 1 }, error: null };
    if (name === "claim_retention_deletions") return { data: batches.shift() ?? [], error: null };
    if (name === "settle_retention_deletions") return { data: args?.p_ids.length ?? 0, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = jest.fn(() => ({ remove }));
  return { rpc: rpc as unknown as jest.Mock, from, remove, client: { rpc, storage: { from } } as unknown as SupabaseClient<Database> };
}

describe("durable retention worker", () => {
  it("drains queued paths even when the current sweep retires no rows", async () => {
    const state = mockClient([[item("older-failed")]]);
    const result = await runRetentionSweep(state.client);
    expect(state.remove).toHaveBeenCalledWith(["older-failed.mp4"]);
    expect(state.rpc).toHaveBeenCalledWith("settle_retention_deletions", {
      p_ids: ["older-failed"], p_lease_token: "lease-1", p_error: null,
    });
    expect(result.objects.revealed).toEqual({ requested: 1, removed: 1 });
  });

  it("persists Storage errors for retry and continues independent buckets", async () => {
    const remove = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Storage offline" } })
      .mockResolvedValueOnce({ data: [{ name: "face.mp4" }], error: null });
    const state = mockClient([[item("output"), item("face", "faces")]], remove);
    const result = await runRetentionSweep(state.client);
    expect(state.rpc).toHaveBeenCalledWith("settle_retention_deletions", {
      p_ids: ["output"], p_lease_token: "lease-1", p_error: "Storage offline",
    });
    expect(result.objects.revealed).toMatchObject({ removed: 0, error: "Storage offline" });
    expect(result.objects.faces.removed).toBe(1);
  });

  it("reschedules thrown network errors instead of losing the claimed paths", async () => {
    const state = mockClient([[item("output")]], jest.fn().mockRejectedValue(new Error("ECONNRESET")));
    await runRetentionSweep(state.client);
    expect(state.rpc).toHaveBeenCalledWith("settle_retention_deletions", {
      p_ids: ["output"], p_lease_token: "lease-1", p_error: "ECONNRESET",
    });
  });

  it("acknowledges already-absent objects after a crash-after-remove retry", async () => {
    const state = mockClient([[item("already-gone")]], jest.fn().mockResolvedValue({ data: [], error: null }));
    await runRetentionSweep(state.client);
    expect(state.rpc).toHaveBeenCalledWith("settle_retention_deletions", {
      p_ids: ["already-gone"], p_lease_token: "lease-1", p_error: null,
    });
  });

  it("does not report completion if the lease was replaced before settlement", async () => {
    const state = mockClient([[item("output")]]);
    state.rpc.mockImplementation(async (name) => {
      if (name === "sweep_retention") return { data: {}, error: null };
      if (name === "claim_retention_deletions") return { data: [item("output")], error: null };
      return { data: 0, error: null };
    });
    await expect(runRetentionSweep(state.client)).rejects.toThrow("lease expired");
  });

  it("does not touch Storage when the queue RPC is unavailable", async () => {
    const state = mockClient([]);
    state.rpc.mockImplementation(async (name) => {
      if (name === "sweep_retention") return { data: {}, error: null };
      return { data: null, error: { message: "queue unavailable" } };
    });
    await expect(runRetentionSweep(state.client)).rejects.toThrow("queue unavailable");
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("bounds one invocation while leaving remaining work durably queued", async () => {
    const state = mockClient(Array.from({ length: 5 }, (_, n) => [item(`object-${n}`)]));
    await runRetentionSweep(state.client);
    expect(state.remove).toHaveBeenCalledTimes(4);
  });
});
