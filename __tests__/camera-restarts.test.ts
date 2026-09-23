import { restartInfoFor } from "@/lib/camera-restarts";

describe("restartInfoFor", () => {
  const base = { camera_name: null, started_at: null, fps: 15 };
  it("keeps restarted cameras the caller may see, with the reason", () => {
    const out = restartInfoFor(
      [
        { ...base, camera_id: "a", restart_count: 3, last_error: "source dropped (no frames)" },
        { ...base, camera_id: "b", restart_count: 0, last_error: null },
        { ...base, camera_id: "c", restart_count: 2, last_error: "capture failed: OSError" },
        { ...base, camera_id: "d" },
      ],
      new Set(["a", "b", "d"]),
    );
    expect(out).toEqual({ a: { count: 3, lastError: "source dropped (no frames)" } });
  });

  it("tolerates missing / odd fields from an older ML build", () => {
    const out = restartInfoFor(
      [{ ...base, camera_id: "a", restart_count: 1, last_error: "" }],
      new Set(["a"]),
    );
    expect(out).toEqual({ a: { count: 1, lastError: null } });
  });
});
