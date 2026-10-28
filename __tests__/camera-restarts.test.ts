import { formatRetryClockKst, reconnectText, restartInfoFor } from "@/lib/camera-restarts";
import { t as translate, type TranslationKey } from "@/lib/i18n/translations";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LangProvider } from "@/lib/i18n/client";
import { CameraReconnectLine, CameraRestartBadge } from "@/components/camera-restart-status";

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
    expect(out).toEqual({
      a: { count: 3, lastError: "source dropped (no frames)", state: "running", nextRetryAt: null },
    });
  });

  it("tolerates missing / odd fields from an older ML build", () => {
    const out = restartInfoFor(
      [{ ...base, camera_id: "a", restart_count: 1, last_error: "" }],
      new Set(["a"]),
    );
    expect(out).toEqual({ a: { count: 1, lastError: null, state: "running", nextRetryAt: null } });
  });

  it("includes every visible camera in backoff, even before its first restart", () => {
    const out = restartInfoFor(
      [
        {
          ...base,
          camera_id: "a",
          state: "backoff",
          restart_count: 0,
          last_error: "source unreachable at open",
          next_retry_at: "2026-09-27T05:04:30Z",
        },
        { ...base, camera_id: "b", state: "backoff", restart_count: 2, next_retry_at: null },
        { ...base, camera_id: "hidden", state: "backoff", restart_count: 7, last_error: "x" },
      ],
      new Set(["a", "b"]),
    );
    expect(out).toEqual({
      a: {
        count: 0,
        lastError: "source unreachable at open",
        state: "backoff",
        nextRetryAt: "2026-09-27T05:04:30.000Z",
      },
      b: { count: 2, lastError: null, state: "backoff", nextRetryAt: null },
    });
    // The authorisation filter is the only gate: nothing about "hidden" leaks.
    expect(JSON.stringify(out)).not.toContain("hidden");
  });

  it("drops a reason that looks like a URL or credentials, and bad retry times", () => {
    const out = restartInfoFor(
      [
        { ...base, camera_id: "a", restart_count: 1, last_error: "open rtsp://admin:pw@10.0.0.5/s failed" }, // pragma: allowlist secret
        { ...base, camera_id: "b", restart_count: 1, last_error: "auth admin:pw@cam.local refused" },
        { ...base, camera_id: "c", state: "backoff", last_error: "x".repeat(500), next_retry_at: "soon" },
      ],
      new Set(["a", "b", "c"]),
    );
    expect(out.a.lastError).toBeNull();
    expect(out.b.lastError).toBeNull();
    expect(out.c.lastError).toHaveLength(200);
    expect(out.c.nextRetryAt).toBeNull();
    expect(JSON.stringify(out)).not.toMatch(/rtsp|pw@|10\.0\.0\.5/);
  });

  it("keeps ordinary reasons that contain a colon", () => {
    const out = restartInfoFor(
      [{ ...base, camera_id: "a", restart_count: 1, last_error: "capture task failed: RuntimeError" }],
      new Set(["a"]),
    );
    expect(out.a.lastError).toBe("capture task failed: RuntimeError");
  });

  it("lets a running entry win over a backoff entry for the same camera", () => {
    const out = restartInfoFor(
      [
        { ...base, camera_id: "a", restart_count: 2, last_error: "source dropped (no frames)" },
        { ...base, camera_id: "a", state: "backoff", restart_count: 2, next_retry_at: "2026-09-27T05:04:30Z" },
      ],
      new Set(["a"]),
    );
    expect(out.a.state).toBe("running");
    expect(out.a.nextRetryAt).toBeNull();
  });
});

describe("formatRetryClockKst", () => {
  const now = Date.parse("2026-09-27T05:00:00Z"); // 14:00 KST

  it("renders HH:mm in Asia/Seoul regardless of the host time zone", () => {
    expect(formatRetryClockKst("2026-09-27T05:04:30Z", now)).toBe("14:04");
    expect(formatRetryClockKst("2026-09-27T14:59:59Z", now)).toBe("23:59");
    // Past KST midnight → 24-hour clock with a leading zero.
    expect(formatRetryClockKst("2026-09-27T15:03:00Z", now)).toBe("00:03");
    expect(formatRetryClockKst("2026-09-27T05:04:30+09:00", Date.parse("2026-09-26T19:00:00Z"))).toBe("05:04");
  });

  it("returns null when there is nothing to show", () => {
    expect(formatRetryClockKst(null, now)).toBeNull();
    expect(formatRetryClockKst(undefined, now)).toBeNull();
    expect(formatRetryClockKst("not a date", now)).toBeNull();
    // Already due: the retry is imminent, a past clock would read as stale.
    expect(formatRetryClockKst("2026-09-27T04:59:59Z", now)).toBeNull();
    expect(formatRetryClockKst("2026-09-27T05:00:00Z", now)).toBeNull();
  });
});

describe("reconnectText", () => {
  const now = Date.parse("2026-09-27T05:00:00Z");
  const backoff = { count: 3, lastError: "source dropped (no frames)", state: "backoff" as const };
  const en = (k: TranslationKey) => translate(k, "en");

  it("names the next try in KST, in every language", () => {
    const info = { ...backoff, nextRetryAt: "2026-09-27T05:05:00.000Z" };
    expect(reconnectText(info, en, now)).toBe("Reconnecting — next try at 14:05 (KST)");
    expect(reconnectText(info, (k) => translate(k, "mn"), now)).toBe(
      "Дахин холбогдож байна — дараагийн оролдлого 14:05 (KST)",
    );
    expect(reconnectText(info, (k) => translate(k, "kr"), now)).toBe("재연결 중 — 다음 시도 14:05 (KST)");
  });

  it("says 'retrying shortly' when the time is unknown or due, and nothing when running", () => {
    expect(reconnectText({ ...backoff, nextRetryAt: null }, en, now)).toBe("Reconnecting — retrying shortly");
    expect(reconnectText({ ...backoff, nextRetryAt: "2026-09-27T04:00:00.000Z" }, en, now)).toBe(
      "Reconnecting — retrying shortly",
    );
    expect(reconnectText({ ...backoff, state: "running", nextRetryAt: null }, en, now)).toBeNull();
  });
});

describe("compact reconnect / restart markup (phone tiles)", () => {
  const info = {
    count: 5,
    lastError: "source dropped (no frames)",
    state: "backoff" as const,
    nextRetryAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const render = (el: ReturnType<typeof createElement>) =>
    renderToStaticMarkup(createElement(LangProvider, { initial: "en", children: el }));

  it("shows only the HH:mm of the next try, and the whole sentence to screen readers", () => {
    const html = render(createElement(CameraReconnectLine, { info, onDark: true, compact: true }));
    const clock = formatRetryClockKst(info.nextRetryAt)!;
    expect(html).toContain(`<span aria-hidden="true" class="truncate tabular-nums">${clock}</span>`);
    expect(html).toContain(`<span class="sr-only">${reconnectText(info, (k) => translate(k, "en"))}</span>`);
  });

  it("falls back to the sentence when no time is known, with the same markup", () => {
    const due = { ...info, nextRetryAt: null };
    const html = render(createElement(CameraReconnectLine, { info: due, onDark: true, compact: true }));
    expect(html).toContain(`class="truncate tabular-nums">${translate("camera_reconnecting", "en")}`);
  });

  it("the compact restart badge reads ×N, the words stay for screen readers", () => {
    const html = render(createElement(CameraRestartBadge, { info, onDark: true, compact: true }));
    expect(html).toContain('<span aria-hidden="true" class="whitespace-nowrap">×5</span>');
    expect(html).toContain(`<span class="sr-only">${translate("grid_restarted", "en")} ×5</span>`);
  });

  it("the full variants are unchanged", () => {
    const html = render(createElement(CameraRestartBadge, { info, onDark: true }));
    expect(html).toContain(`${translate("grid_restarted", "en")} ×5`);
    expect(html).not.toContain('aria-hidden="true" class="whitespace-nowrap"');
  });
});
