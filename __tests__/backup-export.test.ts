/**
 * Shaping tests for /api/admin/backup — the artifact a restore drill depends
 * on. Auth, step-up and the service client are mocked at the module boundary;
 * the route builds the real ZIP.
 *
 * What is pinned here:
 *   • the column allow-lists (NOT NULL columns present, auth material absent)
 *   • the faces `.enc` suffix rule, mirrored from the retention trigger
 *   • storage manifests derived from the DATABASE, never from storage.list()
 *   • biometric columns only when ?include_biometrics=1, with its own audit row
 */
import JSZip from "jszip";
import { NextResponse } from "next/server";

type Row = Record<string, unknown>;

const state: {
  fresh: boolean;
  auth: "ok" | "forbidden";
  rows: Record<string, Row[]>;
  selects: Record<string, string[]>;
  audits: Row[];
  storageListed: boolean;
  superAdmin: boolean;
} = { fresh: true, auth: "ok", rows: {}, selects: {}, audits: [], storageListed: false, superAdmin: true };

jest.mock("@/lib/supabase/auth", () => ({
  requireAdminApi: jest.fn(async () => {
    if (state.auth === "forbidden") {
      return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
    }
    return {
      user: { id: "admin-1", email: "admin@x" },
      profile: { role: "admin", is_super_admin: state.superAdmin },
    };
  }),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/auth/step-up", () => ({ hasFreshReauth: jest.fn(async () => state.fresh) }));

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      // Table dumps + storage sources both go through select().order().range().
      select: (columns: string) => {
        // Table dumps run first, then the storage sources re-select path
        // columns from some of the same tables — keep both.
        (state.selects[table] ??= []).push(columns);
        return {
          order: () => ({
            range: async (from: number, to: number) => ({
              data: (state.rows[table] ?? []).slice(from, to + 1),
              error: null,
            }),
          }),
        };
      },
      insert: async (row: Row) => {
        state.audits.push(row);
        return { error: null };
      },
    }),
    storage: {
      from: () => {
        // The audit's finding: storage.list("") saw 0 of 106 objects because
        // every object lives under a prefix. The route must not use it.
        state.storageListed = true;
        throw new Error("storage listing must not be used to build the manifest");
      },
    },
  }),
}));

/** The column list of the table dump (the storage pass re-selects paths later). */
function dumped(table: string): string {
  const calls = state.selects[table];
  if (!calls?.length) throw new Error(`${table} was never selected`);
  return calls[0];
}

function call(query = "") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/admin/backup/route") as {
    GET: (req: Request) => Promise<Response>;
  };
  return GET(new Request(`http://localhost/api/admin/backup${query}`));
}

async function open(query = "") {
  const res = await call(query);
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const read = async (name: string) => {
    const file = zip.file(name);
    if (!file) throw new Error(`${name} missing from the ZIP`);
    return file.async("string");
  };
  const json = async (name: string) => JSON.parse(await read(name));
  return { res, zip, read, json };
}

beforeEach(() => {
  state.fresh = true;
  state.auth = "ok";
  state.audits = [];
  state.storageListed = false;
  state.superAdmin = true;
  state.selects = {};
  state.rows = {
    profiles: [{ id: "u1", email: "a@x" }],
    cameras: [{ id: "c1", name: "Lobby", url: "enc:v1:abcdef" }],
    suspects: [{ id: "s1", name: "S", image_path: "suspects/s1.jpg" }],
    recordings: [
      // on_demand: storage_path === original_path — one object, not two.
      { id: "r1", storage_path: "cam1/r1.mp4.enc", original_path: "cam1/r1.mp4.enc" },
      // legacy baked: two distinct objects.
      { id: "r2", storage_path: "cam1/r2_blurred.mp4.enc", original_path: "cam1/r2_original.mp4.enc" },
      { id: "r3", storage_path: "cam1/r3.mp4.enc", original_path: null },
    ],
    faces: [
      { id: "f1", image_path: "cam1/f1.jpg", crop_sealed: true },
      { id: "f2", image_path: "cam1/f2.jpg", crop_sealed: false },
    ],
    alerts: [
      { id: "a1", screenshot_path: "cam1/a1.jpg" },
      { id: "a2", screenshot_path: null },
    ],
    reveal_jobs: [{ id: "j1", output_path: "reveal/j1.mp4" }],
    webhooks: [{ id: "w1", name: "slack", kind: "slack" }],
    push_subscriptions: [{ id: "p1", user_id: "u1" }],
    alert_rules: [],
    audit_log: [],
    camera_permissions: [],
    masking_schedules: [],
    privacy_zones: [],
    retention_policies: [],
    clusters: [],
  };
});

describe("GET /api/admin/backup — column allow-lists", () => {
  it("exports every NOT NULL column a restore needs, except the biometric ones", async () => {
    await open();
    expect(dumped("cameras")).toContain("url"); // NOT NULL — cameras were unreachable without it
    expect(dumped("profiles")).toContain("email");
    expect(dumped("suspects")).toContain("image_path");
    expect(dumped("faces")).toContain("image_path");
    expect(dumped("suspects")).not.toContain("embedding");
    expect(dumped("faces")).not.toContain("embedding");
  });

  it("never exports auth material or outbound secrets", async () => {
    await open("?include_biometrics=1");
    expect(dumped("profiles")).not.toMatch(/totp_secret|totp_recovery_codes|passkey/);
    expect(dumped("webhooks")).not.toMatch(/\bsecret\b/);
    expect(dumped("webhooks")).not.toMatch(/\burl\b/);
    expect(dumped("push_subscriptions")).not.toMatch(/endpoint|p256dh/);
  });

  it("names the unrestorable tables and their missing columns in manifest.json", async () => {
    const { json } = await open();
    const m = await json("manifest.json");
    expect(m.include_biometrics).toBe(false);
    expect(m.tables.suspects).toMatchObject({ restorable: false, missing_required: ["embedding"] });
    expect(m.tables.faces).toMatchObject({ restorable: false, missing_required: ["embedding"] });
    expect(m.tables.webhooks).toMatchObject({ restorable: false, missing_required: ["url"] });
    expect(m.tables.push_subscriptions.missing_required).toEqual(["endpoint", "p256dh", "auth"]);
    expect(m.tables.cameras.restorable).toBe(true);
    expect(m.cannot_restore.auth_users).toMatch(/auth\.users/);
  });

  it("states the restore limits in all three UI languages when biometrics are excluded", async () => {
    const { read } = await open();
    const readme = await read("README.txt");
    expect(readme).toContain("RESTORE LIMITS (English)");
    expect(readme).toContain("СЭРГЭЭХ ХЯЗГААР (Монгол)");
    expect(readme).toContain("복원 한계 (한국어)");
    expect(readme).toMatch(/suspects\.embedding/);
    expect(readme).toMatch(/auth\.users/);
    expect(readme).toContain("[NOT RESTORABLE]");
  });
});

describe("GET /api/admin/backup — biometric flag", () => {
  it("adds the embedding columns only when the flag is set", async () => {
    await open("?include_biometrics=1");
    expect(dumped("suspects")).toContain("embedding");
    expect(dumped("faces")).toContain("embedding, embedding_sealed");
    expect(dumped("reveal_jobs")).toContain("query_embedding");
  });

  it("flips the tables to restorable and warns in the README", async () => {
    const { json, read } = await open("?include_biometrics=1");
    const m = await json("manifest.json");
    expect(m.include_biometrics).toBe(true);
    expect(m.tables.suspects.restorable).toBe(true);
    expect(m.tables.faces.restorable).toBe(true);
    expect(m.biometric_columns).toEqual(
      expect.arrayContaining(["suspects.embedding", "faces.embedding"]),
    );
    const readme = await read("README.txt");
    expect(readme).toContain("BIOMETRIC PERSONAL DATA");
    expect(readme).toContain("suspects.embedding");
  });

  it("writes a second audit row naming exactly what was exported", async () => {
    await open("?include_biometrics=1");
    const actions = state.audits.map((a) => a.action);
    expect(actions).toEqual(["BACKUP_DOWNLOAD", "BACKUP_DOWNLOAD_BIOMETRIC"]);
    expect(String(state.audits[0].detail)).toContain("biometrics=included");
    expect(String(state.audits[1].detail)).toContain("suspects.embedding");
    expect(String(state.audits[1].detail)).toContain("faces.embedding");
  });

  it("keeps a plain export to one audit row", async () => {
    await open();
    expect(state.audits.map((a) => a.action)).toEqual(["BACKUP_DOWNLOAD"]);
    expect(String(state.audits[0].detail)).toContain("biometrics=excluded");
  });

  it("treats anything but 1/true as excluded", async () => {
    await open("?include_biometrics=maybe");
    expect(dumped("faces")).not.toContain("embedding");
  });
});

describe("GET /api/admin/backup — storage manifests", () => {
  it("enumerates objects from the database, not from a Storage listing", async () => {
    const { json } = await open();
    expect(state.storageListed).toBe(false);
    const recordings = await json("buckets/recordings.manifest.json");
    // r1 stores one object under two columns; r2 stores two; r3 stores one.
    expect(recordings.objects.map((o: Row) => o.path)).toEqual([
      "cam1/r1.mp4.enc",
      "cam1/r2_blurred.mp4.enc",
      "cam1/r2_original.mp4.enc",
      "cam1/r3.mp4.enc",
    ]);
    expect(recordings.total_objects).toBe(4);
    expect(recordings.derived_from[0]).toContain("recordings.storage_path");
  });

  it("appends .enc to sealed crops only — the retention trigger's rule", async () => {
    const { json } = await open();
    const faces = await json("buckets/faces.manifest.json");
    expect(faces.objects.map((o: Row) => o.path)).toEqual(["cam1/f1.jpg.enc", "cam1/f2.jpg"]);
    expect(faces.total_objects).toBe(2);
  });

  it("covers every bucket and skips rows with no object", async () => {
    const { json } = await open();
    expect((await json("buckets/suspects.manifest.json")).objects).toEqual([
      { path: "suspects/s1.jpg", source: "suspects", row_id: "s1" },
    ]);
    // a2 has no screenshot — it must not appear as an empty path.
    expect((await json("buckets/alert-screenshots.manifest.json")).total_objects).toBe(1);
    expect((await json("buckets/revealed.manifest.json")).total_objects).toBe(1);
    const m = await json("manifest.json");
    expect(Object.keys(m.buckets).sort()).toEqual([
      "alert-screenshots",
      "faces",
      "recordings",
      "revealed",
      "suspects",
    ]);
  });

  it("pages past the PostgREST 1000-row cap", async () => {
    state.rows.faces = Array.from({ length: 1200 }, (_, i) => ({
      id: `f${i}`,
      image_path: `cam1/f${i}.jpg`,
      crop_sealed: false,
    }));
    const { json } = await open();
    expect((await json("buckets/faces.manifest.json")).total_objects).toBe(1200);
    expect((await json("tables/faces.json")).length).toBe(1200);
  });
});

describe("GET /api/admin/backup — gates", () => {
  it("requires fresh step-up reauth", async () => {
    state.fresh = false;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "REAUTH_REQUIRED" });
    expect(state.audits).toEqual([]);
  });

  it("requires fresh step-up reauth for the biometric export too", async () => {
    state.fresh = false;
    expect((await call("?include_biometrics=1")).status).toBe(401);
  });

  it("passes the admin guard's rejection through", async () => {
    state.auth = "forbidden";
    expect((await call()).status).toBe(403);
  });

  it("refuses the biometric copy to an admin who is not the super admin", async () => {
    state.superAdmin = false;
    const res = await call("?include_biometrics=1");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("BIOMETRIC_EXPORT_FORBIDDEN");
    // The ordinary export is unaffected.
    expect((await call()).status).toBe(200);
  });

  it("marks the biometric download in the filename", async () => {
    const plain = await call();
    expect(plain.headers.get("content-disposition")).toMatch(/mongolz-backup-\d+\.zip/);
    const full = await call("?include_biometrics=1");
    expect(full.headers.get("content-disposition")).toContain("mongolz-backup-biometric-");
  });
});
