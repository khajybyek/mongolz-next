import { isUploadAcknowledged, RecordingUploadQueue } from "@/lib/recording-upload";

describe("recording upload recovery", () => {
  test("a failed first chunk blocks the final marker and retains bytes for ordered retry", async () => {
    let offline = true;
    const calls: Array<[number, boolean]> = [];
    const errors: string[] = [];
    const queue = new RecordingUploadQueue(async (chunk) => {
      calls.push([chunk.index, chunk.final]);
      if (offline) throw new Error("HTTP 502");
    }, (error) => errors.push(error.message));
    queue.enqueue(new Blob(["first"]));
    queue.enqueue(new Blob(["last"]), true);
    await expect(queue.finish()).rejects.toThrow("HTTP 502");
    expect(calls).toEqual([[0, false]]);
    expect(queue.pendingBytes).toBe(9);
    expect(errors).toEqual(["HTTP 502"]);
    offline = false;
    await queue.retry();
    expect(calls).toEqual([[0, false], [0, false], [1, true]]);
    expect(queue.pendingBytes).toBe(0);
  });

  test("a failed final acknowledgement never completes; retry reuses its index", async () => {
    let attempts = 0;
    const calls: number[] = [];
    const queue = new RecordingUploadQueue(async (chunk) => {
      calls.push(chunk.index);
      if (chunk.final && attempts++ === 0) throw new Error("connection lost");
    }, () => {});
    queue.enqueue(new Blob(["data"]));
    queue.enqueue(new Blob(), true);
    await expect(queue.finish()).rejects.toThrow("connection lost");
    await queue.retry();
    expect(calls).toEqual([0, 1, 1]);
    await queue.finish();
    expect(calls).toEqual([0, 1, 1]);
  });

  test("an unfinished recording cannot be announced as processing", async () => {
    const queue = new RecordingUploadQueue(async () => {}, () => {});
    queue.enqueue(new Blob(["data"]));
    await expect(queue.finish()).rejects.toThrow("not been accepted");
  });

  test("only explicit complete-session receipts count as final success", () => {
    for (const body of [null, {}, "<html>Login</html>", { ok: true }, { ok: true, status: "chunk_received" }, { ok: true, status: "processing" }]) {
      expect(isUploadAcknowledged(body, true)).toBe(false);
    }
    expect(isUploadAcknowledged({ ok: true, status: "processing", recording_id: "recording-1" }, true)).toBe(true);
    expect(isUploadAcknowledged({ ok: true, status: "chunk_received" }, false)).toBe(true);
  });
});
