/**
 * lib/ml-client.ts — GET /camera/active. `cameras` keeps meaning "running,
 * HLS playable" for every caller; the newer `reconnecting` list is optional.
 */
import { mlActiveCameras, mlCameraSupervision } from "@/lib/ml-client";

const realFetch = global.fetch;
function respond(body: unknown, status = 200) {
  global.fetch = jest.fn(async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

afterEach(() => {
  global.fetch = realFetch;
});

describe("mlCameraSupervision", () => {
  it("splits running and reconnecting cameras", async () => {
    respond({
      cameras: [{ camera_id: "a", restart_count: 1, state: "running", next_retry_at: null }],
      reconnecting: [{ camera_id: "b", restart_count: 0, next_retry_at: "2026-09-27T05:04:30Z" }],
    });
    const status = await mlCameraSupervision();
    expect(status?.active.map((c) => c.camera_id)).toEqual(["a"]);
    // An entry in `reconnecting` is backoff by definition.
    expect(status?.reconnecting).toEqual([
      { camera_id: "b", restart_count: 0, next_retry_at: "2026-09-27T05:04:30Z", state: "backoff" },
    ]);
    expect(await mlActiveCameras()).toEqual(status?.active);
  });

  it("treats an older ML build without `reconnecting` as nothing reconnecting", async () => {
    respond({ cameras: [{ camera_id: "a" }] });
    expect(await mlCameraSupervision()).toEqual({ active: [{ camera_id: "a" }], reconnecting: [] });
  });

  it("resolves to null when the service is unreachable or refuses", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    expect(await mlCameraSupervision()).toBeNull();
    expect(await mlActiveCameras()).toBeNull();
    respond({ detail: "nope" }, 503);
    expect(await mlCameraSupervision()).toBeNull();
  });
});
