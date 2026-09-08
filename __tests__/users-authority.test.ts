/**
 * Authority boundary on /users (2026-09-08 audit, 5.2).
 *
 * ADR 0009 sells reveal_level as a hierarchy: "an operator at level N can
 * unseal faces with chain_index >= N and only those". It was self-service —
 * any admin could set ANY profile's level, their own included, to 0 and
 * become a director in one action. These tests pin the rules that make the
 * hierarchy a boundary, and just as importantly the paths that must keep
 * working (three real admins run this console).
 */
import { T } from "@/lib/i18n/translations";

const DIRECTOR = "11111111-1111-4111-8111-111111111111";
const SUPER = "22222222-2222-4222-8222-222222222222";
const L3 = "33333333-3333-4333-8333-333333333333";
const L5 = "55555555-5555-4555-8555-555555555555";
const VIEWER = "99999999-9999-4999-8999-999999999999";
const UNKNOWN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MINTED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = {
  id: string;
  email: string;
  role: string;
  reveal_level: unknown;
  is_super_admin: boolean;
};

type Payload = { data: unknown; error: { message: string } | null; count?: number };

const state = {
  actor: DIRECTOR,
  profiles: [] as Row[],
  readErrorIds: new Set<string>(),
  readThrowIds: new Set<string>(),
  createUserError: null as string | null,
};

const writes = {
  updates: [] as Array<{ id: string; values: Record<string, unknown> }>,
  upserts: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  createdUsers: [] as Array<Record<string, unknown>>,
  deletedUsers: [] as string[],
};

function seed() {
  state.actor = DIRECTOR;
  state.readErrorIds = new Set();
  state.readThrowIds = new Set();
  state.createUserError = null;
  state.profiles = [
    { id: DIRECTOR, email: "director@test", role: "admin", reveal_level: 0, is_super_admin: false },
    { id: SUPER, email: "super@test", role: "admin", reveal_level: 0, is_super_admin: true },
    { id: L3, email: "l3@test", role: "admin", reveal_level: 3, is_super_admin: false },
    { id: L5, email: "l5@test", role: "admin", reveal_level: 5, is_super_admin: false },
    { id: VIEWER, email: "viewer@test", role: "viewer", reveal_level: 0, is_super_admin: false },
  ];
  writes.updates = [];
  writes.upserts = [];
  writes.audits = [];
  writes.createdUsers = [];
  writes.deletedUsers = [];
}

function payload(data: unknown, error: { message: string } | null = null, count?: number) {
  const value: Payload = { data, error, count };
  return {
    single: async () => value,
    maybeSingle: async () => value,
    then: (resolve: (v: Payload) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
}

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({ get: () => undefined }),
}));
jest.mock("@/lib/supabase/auth", () => ({
  requireAdmin: jest.fn(async () => {
    const row = state.profiles.find((p) => p.id === state.actor);
    return {
      user: { id: state.actor, email: row?.email ?? "actor@test" },
      profile: { id: state.actor, role: "admin" },
    };
  }),
}));
jest.mock("@/lib/auth/step-up", () => ({ ensureFreshReauth: jest.fn(async () => null) }));
jest.mock("@/lib/supabase/server", () => {
  const client = () => ({
    from: (table: string) => ({
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => ({
        eq: (col: string, value: string) => {
          if (table !== "profiles") return payload(null);
          if (col === "role") {
            return payload(null, null, state.profiles.filter((p) => p.role === value).length);
          }
          if (state.readThrowIds.has(value)) {
            return {
              single: async () => {
                throw new Error("connection reset");
              },
              then: (resolve: (v: Payload) => unknown) =>
                Promise.resolve({ data: null, error: { message: "connection reset" } }).then(resolve),
            };
          }
          if (state.readErrorIds.has(value)) return payload(null, { message: "offline" });
          void opts;
          return payload(state.profiles.find((p) => p.id === value) ?? null);
        },
      }),
      update: (values: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          writes.updates.push({ id, values });
          return { error: null };
        },
      }),
      upsert: async (values: Record<string, unknown>) => {
        writes.upserts.push(values);
        return { error: null };
      },
      insert: async (row: Record<string, unknown>) => {
        if (table === "audit_log") writes.audits.push(row);
        return { error: null };
      },
    }),
    auth: {
      admin: {
        createUser: async (args: Record<string, unknown>) => {
          writes.createdUsers.push(args);
          return state.createUserError
            ? { data: { user: null }, error: { message: state.createUserError } }
            : { data: { user: { id: MINTED } }, error: null };
        },
        deleteUser: async (id: string) => {
          writes.deletedUsers.push(id);
          return { error: null };
        },
        updateUserById: async () => ({ error: null }),
      },
    },
  });
  return { createServiceClient: client, createClient: async () => client() };
});

import {
  changeRoleAction,
  createUserAction,
  deleteUserAction,
  resetPasswordAction,
  setRevealLevelAction,
} from "@/app/(app)/users/actions";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

const setLevel = (user_id: string, reveal_level: number) =>
  setRevealLevelAction(form({ user_id, reveal_level: String(reveal_level) }));

const promote = (user_id: string, role = "admin") =>
  changeRoleAction(form({ user_id, role }));

const remove = (user_id: string) => deleteUserAction(form({ user_id }));

const resetPassword = (user_id: string) =>
  resetPasswordAction(form({ user_id, password: "another long secret" }));

const create = (extra: Record<string, string> = {}) =>
  createUserAction(
    form({ email: "new@example.test", password: "correct horse", role: "admin", ...extra }),
  );

function deniedAudits(action: string) {
  return writes.audits.filter((a) => a.action === action);
}

beforeEach(() => {
  jest.clearAllMocks();
  seed();
});

describe("setRevealLevelAction — nobody grants themselves authority", () => {
  it.each([
    ["a restricted admin", L3],
    ["a director", DIRECTOR],
  ])("refuses %s targeting their own profile and records the refusal", async (_label, actor) => {
    state.actor = actor;
    const res = await setLevel(actor, 0);
    expect(res).toEqual({ error: T.users_err_level_self.mn });
    expect(writes.updates).toHaveLength(0);
    const denials = deniedAudits("USER_REVEAL_LEVEL_DENIED");
    expect(denials).toHaveLength(1);
    expect(String(denials[0].detail)).toContain("self-target");
    expect(denials[0].user_id).toBe(actor);
  });

  it("refuses a level broader than the caller's own", async () => {
    state.actor = L3;
    for (const level of [0, 1, 2]) {
      const res = await setLevel(L5, level);
      expect(res).toEqual({
        error: T.users_err_level_ceiling.mn.replace("{level}", "3"),
      });
    }
    expect(writes.updates).toHaveLength(0);
    expect(deniedAudits("USER_REVEAL_LEVEL_DENIED")).toHaveLength(3);
  });

  it("lets a restricted admin assign their own level or narrower", async () => {
    state.actor = L3;
    expect(await setLevel(L5, 3)).toEqual({ ok: true });
    expect(await setLevel(L5, 42)).toEqual({ ok: true });
    expect(writes.updates.map((u) => u.values)).toEqual([{ reveal_level: 3 }, { reveal_level: 42 }]);
  });

  it("lets a director create another director and records the previous level", async () => {
    state.actor = DIRECTOR;
    expect(await setLevel(L5, 0)).toEqual({ ok: true });
    expect(writes.updates).toEqual([{ id: L5, values: { reveal_level: 0 } }]);
    const granted = writes.audits.find((a) => a.action === "USER_REVEAL_LEVEL");
    expect(String(granted?.detail)).toContain("reveal_level 0 (was 5, by L0)");
  });

  it("refuses to rewrite the level of an operator with broader authority", async () => {
    state.actor = L3;
    const res = await setLevel(DIRECTOR, 9);
    expect(res).toEqual({ error: T.users_err_level_target_higher.mn });
    expect(writes.updates).toHaveLength(0);
  });

  it.each([
    ["read error", (id: string) => state.readErrorIds.add(id)],
    ["thrown error", (id: string) => state.readThrowIds.add(id)],
  ])("refuses when the caller's own authority is unknown (%s)", async (_label, breakRead) => {
    state.actor = L3;
    breakRead(L3);
    const res = await setLevel(L5, 7);
    expect(res).toEqual({ error: T.users_err_authority_unavailable.mn });
    expect(writes.updates).toHaveLength(0);
    expect(deniedAudits("USER_REVEAL_LEVEL_DENIED")).toHaveLength(1);
  });

  it("refuses a caller whose profile is no longer an admin", async () => {
    state.actor = VIEWER; // demoted between the page render and the action
    expect(await setLevel(L5, 7)).toEqual({ error: T.users_err_authority_unavailable.mn });
    expect(writes.updates).toHaveLength(0);
  });

  it("keeps the super admin a director", async () => {
    state.actor = DIRECTOR;
    expect(await setLevel(SUPER, 4)).toEqual({ error: T.users_err_super_admin_level.mn });
    expect(writes.updates).toHaveLength(0);
    expect(await setLevel(SUPER, 0)).toEqual({ ok: true });
  });

  it("refuses an unknown target instead of silently updating nothing", async () => {
    state.actor = DIRECTOR;
    expect(await setLevel(UNKNOWN, 5)).toEqual({ error: T.users_err_target_missing.mn });
    expect(writes.updates).toHaveLength(0);
  });

  it("rejects an out-of-range level before touching the database", async () => {
    state.actor = DIRECTOR;
    expect(await setLevel(L5, 100)).toEqual({ error: T.users_err_level_range.mn });
    expect(writes.updates).toHaveLength(0);
  });
});

describe("createUserAction — a new account inherits the creator's ceiling", () => {
  it("stamps the creator's own level on the profile", async () => {
    state.actor = L3;
    expect(await create()).toEqual({ ok: true });
    expect(writes.upserts).toEqual([
      expect.objectContaining({ id: MINTED, role: "admin", reveal_level: 3 }),
    ]);
  });

  it("lets a director create a director", async () => {
    state.actor = DIRECTOR;
    expect(await create()).toEqual({ ok: true });
    expect(writes.upserts[0]).toMatchObject({ reveal_level: 0 });
  });

  it("refuses a broader level than the creator holds, before minting the account", async () => {
    state.actor = L3;
    const res = await create({ reveal_level: "0" });
    expect(res).toEqual({ error: T.users_err_level_ceiling.mn.replace("{level}", "3") });
    expect(writes.createdUsers).toHaveLength(0);
    expect(writes.upserts).toHaveLength(0);
    expect(deniedAudits("USER_CREATE_DENIED")).toHaveLength(1);
  });

  it("accepts an explicit narrower level", async () => {
    state.actor = L3;
    expect(await create({ reveal_level: "8" })).toEqual({ ok: true });
    expect(writes.upserts[0]).toMatchObject({ reveal_level: 8 });
  });

  it("treats an empty level field as omitted rather than as director", async () => {
    state.actor = L3;
    expect(await create({ reveal_level: "" })).toEqual({ ok: true });
    expect(writes.upserts[0]).toMatchObject({ reveal_level: 3 });
  });

  it("stamps the level on non-admin roles too, so a later promotion cannot inherit 0", async () => {
    state.actor = L3;
    expect(await create({ role: "viewer" })).toEqual({ ok: true });
    expect(writes.upserts[0]).toMatchObject({ role: "viewer", reveal_level: 3 });
  });

  it("refuses when the creator's authority cannot be read", async () => {
    state.actor = L3;
    state.readErrorIds.add(L3);
    expect(await create()).toEqual({ error: T.users_err_authority_unavailable.mn });
    expect(writes.createdUsers).toHaveLength(0);
  });
});

describe("changeRoleAction — promotion cannot launder authority", () => {
  it("pins a promoted account to the promoter's level", async () => {
    state.actor = L3;
    expect(await promote(VIEWER)).toEqual({ ok: true });
    expect(writes.updates).toEqual([{ id: VIEWER, values: { role: "admin", reveal_level: 3 } }]);
    const row = writes.audits.find((a) => a.action === "USER_ROLE_CHANGE");
    expect(String(row?.detail)).toContain("reveal_level pinned to 3");
  });

  it("leaves an already narrower level alone", async () => {
    state.actor = L3;
    state.profiles.find((p) => p.id === VIEWER)!.reveal_level = 9;
    expect(await promote(VIEWER)).toEqual({ ok: true });
    expect(writes.updates[0].values).toEqual({ role: "admin" });
  });

  it("does not touch authority when a director promotes", async () => {
    state.actor = DIRECTOR;
    expect(await promote(VIEWER)).toEqual({ ok: true });
    expect(writes.updates[0].values).toEqual({ role: "admin" });
  });

  it("refuses to promote when the promoter's authority is unknown", async () => {
    state.actor = L3;
    state.readErrorIds.add(L3);
    expect(await promote(VIEWER)).toEqual({ error: T.users_err_authority_unavailable.mn });
    expect(writes.updates).toHaveLength(0);
    expect(deniedAudits("USER_ROLE_CHANGE_DENIED")).toHaveLength(1);
  });

  it("still demotes when the authority read is failing — a demotion grants nothing", async () => {
    state.actor = DIRECTOR;
    state.readErrorIds.add(DIRECTOR);
    expect(await promote(L5, "viewer")).toEqual({ ok: true });
    expect(writes.updates).toEqual([{ id: L5, values: { role: "viewer" } }]);
  });

  it("keeps refusing a self role change and the super admin's role", async () => {
    state.actor = DIRECTOR;
    expect(await promote(DIRECTOR, "viewer")).toEqual({ error: T.users_err_role_self.mn });
    expect(await promote(SUPER, "viewer")).toEqual({ error: T.users_err_super_admin_role.mn });
    expect(writes.updates).toHaveLength(0);
  });

  it("refuses to re-role an admin with broader authority", async () => {
    state.actor = L5;
    expect(await promote(L3, "viewer")).toEqual({ error: T.users_err_level_target_higher.mn });
    expect(writes.updates).toHaveLength(0);
    expect(deniedAudits("USER_ROLE_CHANGE_DENIED")).toHaveLength(1);
  });

  it("still demotes a narrower admin", async () => {
    state.actor = L3;
    expect(await promote(L5, "viewer")).toEqual({ ok: true });
    expect(writes.updates).toEqual([{ id: L5, values: { role: "viewer" } }]);
  });
});

describe("takeover paths obey the same hierarchy", () => {
  it("refuses to delete or reset an admin with broader authority", async () => {
    state.actor = L5;
    expect(await remove(L3)).toEqual({ error: T.users_err_level_target_higher.mn });
    expect(await resetPassword(L3)).toEqual({ error: T.users_err_level_target_higher.mn });
    expect(writes.deletedUsers).toHaveLength(0);
    expect(deniedAudits("USER_DELETE_DENIED")).toHaveLength(1);
    expect(deniedAudits("USER_PASSWORD_RESET_DENIED")).toHaveLength(1);
  });

  it("lets a director delete and reset anyone else", async () => {
    state.actor = DIRECTOR;
    expect(await remove(L5)).toEqual({ ok: true });
    expect(await resetPassword(L3)).toEqual({ ok: true });
    expect(writes.deletedUsers).toEqual([L5]);
  });

  it("does not block an urgent removal when the caller's level is unreadable", async () => {
    state.actor = L5;
    state.readErrorIds.add(L5);
    expect(await remove(L3)).toEqual({ ok: true });
    expect(await resetPassword(L3)).toEqual({ ok: true });
    expect(writes.deletedUsers).toEqual([L3]);
  });

  it("keeps the last-admin, self and super-admin guards", async () => {
    state.actor = DIRECTOR;
    expect(await remove(DIRECTOR)).toEqual({ error: T.users_err_delete_self.mn });
    expect(await remove(SUPER)).toEqual({ error: T.users_err_super_admin_delete.mn });
    expect(await resetPassword(SUPER)).toEqual({ error: T.users_err_super_admin_password.mn });
    state.profiles = state.profiles.filter((p) => p.id === DIRECTOR || p.id === L3);
    state.profiles.find((p) => p.id === L3)!.role = "viewer";
    expect(await remove(DIRECTOR)).toEqual({ error: T.users_err_delete_self.mn });
    state.actor = L3;
    expect(await remove(DIRECTOR)).toEqual({ error: T.users_err_last_admin.mn });
    expect(writes.deletedUsers).toHaveLength(0);
  });
});
