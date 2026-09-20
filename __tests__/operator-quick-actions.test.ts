import { NextRequest } from "next/server";

const USER = "11111111-1111-4111-8111-111111111111";
const PRESET = "22222222-2222-4222-8222-222222222222";
const ALERT = "33333333-3333-4333-8333-333333333333";

const mockState = {
  upserted: null as Record<string, unknown> | null,
  deletedBy: [] as Array<[string, unknown]>,
  alertPatch: null as Record<string, unknown> | null,
  alertExists: true,
  audits: [] as Array<Record<string, unknown>>,
};

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => ({ user: { id: USER, email: "operator@example.test" }, profile: { role: "admin" } })),
  isAuthErr: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
}));

function presetClient() {
  return {
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        mockState.upserted = row;
        return {
          select: () => ({
            single: async () => ({ data: { id: PRESET, ...row }, error: null }),
          }),
        };
      },
      delete: () => {
        const builder = {
          eq: (column: string, value: unknown) => {
            mockState.deletedBy.push([column, value]);
            return mockState.deletedBy.length === 1 ? builder : Promise.resolve({ error: null });
          },
        };
        return builder;
      },
    }),
  };
}

function serviceClient() {
  return {
    from: (table: string) => {
      if (table === "audit_log") {
        return { insert: async (row: Record<string, unknown>) => { mockState.audits.push(row); return { error: null }; } };
      }
      return {
        update: (patch: Record<string, unknown>) => {
          mockState.alertPatch = patch;
          return {
            eq: () => ({
              select: () => ({
                maybeSingle: async () => ({ data: mockState.alertExists ? { id: ALERT } : null, error: null }),
              }),
            }),
          };
        },
      };
    },
  };
}

jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn(async () => presetClient()),
  createServiceClient: jest.fn(() => serviceClient()),
}));

import { DELETE as deletePreset, POST as savePreset } from "@/app/api/search/presets/route";
import { POST as saveAlertNote } from "@/app/api/alerts/[id]/note/route";

beforeEach(() => {
  mockState.upserted = null;
  mockState.deletedBy = [];
  mockState.alertPatch = null;
  mockState.alertExists = true;
  mockState.audits = [];
});

describe("operator quick-action routes", () => {
  it("saves a validated search preset for the authenticated operator", async () => {
    const response = await savePreset(new NextRequest("https://app.test/api/search/presets", {
      method: "POST",
      body: JSON.stringify({
        name: "Gate · last shift",
        cameraId: "44444444-4444-4444-8444-444444444444",
        from: "2026-09-20T09:00",
        to: "2026-09-20T10:00",
        recordingStatus: "ready",
        minConfidence: "0.82",
        suspectId: "55555555-5555-4555-8555-555555555555",
        incidentId: "66666666-6666-4666-8666-666666666666",
        threshold: "0.63",
        limit: "25",
      }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(200);
    expect(mockState.upserted).toMatchObject({
      user_id: USER,
      name: "Gate · last shift",
      from_at: "2026-09-20T00:00:00.000Z",
      to_at: "2026-09-20T01:00:00.000Z",
      recording_status: "ready",
      min_confidence: 0.82,
      match_threshold: 0.63,
      result_limit: 25,
    });
  });

  it("rejects an invalid preset before writing", async () => {
    const response = await savePreset(new NextRequest("https://app.test/api/search/presets", {
      method: "POST",
      body: JSON.stringify({ name: "Bad", recordingStatus: "deleted" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(400);
    expect(mockState.upserted).toBeNull();
  });

  it("deletes only the authenticated operator's preset", async () => {
    const response = await deletePreset(new NextRequest(`https://app.test/api/search/presets?id=${PRESET}`, { method: "DELETE" }));
    expect(response.status).toBe(200);
    expect(mockState.deletedBy).toEqual([["id", PRESET], ["user_id", USER]]);
  });

  it("trims an alert note and records the operator action", async () => {
    const response = await saveAlertNote(new NextRequest(`https://app.test/api/alerts/${ALERT}/note`, {
      method: "POST",
      body: JSON.stringify({ note: "  Checked the recording  " }),
      headers: { "content-type": "application/json" },
    }), { params: Promise.resolve({ id: ALERT }) });

    expect(response.status).toBe(200);
    expect(mockState.alertPatch).toEqual({ note: "Checked the recording" });
    expect(mockState.audits).toContainEqual(expect.objectContaining({
      action: "ALERT_NOTE_UPDATED",
      user_id: USER,
    }));
  });
});
