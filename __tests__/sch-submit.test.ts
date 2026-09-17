import {
  SCH_NAT_FACTOR,
  SCH_PREPARE_LIMIT,
  SCH_SUBMIT_LIMIT,
  accountNumber,
  classifyInsertError,
  invalidFields,
  rateLimitVerdict,
  replayOutcome,
} from "@/lib/sch/submit";
import {
  SCH_DRAFT_MAX_AGE_MS,
  SCH_DRAFT_UPLOAD_MAX_AGE_MS,
  isDraftEmpty,
  parseDraft,
  serialiseDraft,
  type SchDraft,
} from "@/lib/sch/draft";
import { SCH_LIMITS, receiptPath, schSubmissionSchema } from "@/lib/sch/schema";

describe("rateLimitVerdict", () => {
  it("passes an allowed attempt through", () => {
    expect(rateLimitVerdict({ ok: true, count: 3 })).toBe("ok");
  });

  it("calls a refused attempt with a real count 'limited'", () => {
    expect(rateLimitVerdict({ ok: false, count: 31 })).toBe("limited");
    expect(rateLimitVerdict({ ok: false, count: 0 })).toBe("limited");
  });

  it("reads checkRateLimit's fail-closed signal (count -1) as 'unavailable', not the registrant's fault", () => {
    expect(rateLimitVerdict({ ok: false, count: -1 })).toBe("unavailable");
    expect(rateLimitVerdict(null)).toBe("unavailable");
    expect(rateLimitVerdict(undefined)).toBe("unavailable");
  });
});

describe("invalidFields", () => {
  const SUB = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
  const valid = {
    submission_id: SUB,
    receipt_path: `submissions/${SUB}/receipt.jpg`,
    person: { full_name: "Bat Bold", email: "bat@example.com", facebook: "fb.com/bat", phone: "" },
    entries: [
      { game: "mobile_legends", rank: "Epic", roles: ["Jungle"], in_game_id: "1 (2)" },
      { game: "cs2", premier_rank: "", steam_url: "steamcommunity.com/id/bat", faceit: "no" },
      { game: "dota2", rank: "Herald", roles: ["Position 1 (Carry)"], steam_url: "steamcommunity.com/id/bat" },
    ],
    website: "",
  };
  const issuesFor = (input: unknown) => {
    const r = schSubmissionSchema.safeParse(input);
    if (r.success) throw new Error("expected the input to be rejected");
    return r.error.issues;
  };

  it("maps person issues to the form's person keys, in schema order and de-duplicated", () => {
    const input = { ...valid, person: { full_name: "B", email: "батаа@example.com", facebook: "" } };
    expect(invalidFields(issuesFor(input), input)).toEqual(["full_name", "email", "facebook"]);
  });

  it("maps entry issues to the game section they belong to", () => {
    const input = {
      ...valid,
      entries: [
        { game: "mobile_legends", rank: "Diamond", roles: [], in_game_id: "" },
        { game: "cs2", premier_rank: "", steam_url: "nope", faceit: "maybe" },
        { game: "dota2", rank: "Bronze", roles: [], steam_url: "" },
      ],
    };
    expect(invalidFields(issuesFor(input), input)).toEqual([
      "ml_rank", "ml_roles", "ml_id", "cs2_steam", "cs2_faceit", "dota_roles", "dota_rank", "dota_steam",
    ]);
  });

  it("maps array-level entry issues (empty, duplicate game) to 'games' and the receipt mismatch to 'receipt'", () => {
    const empty = { ...valid, entries: [] };
    expect(invalidFields(issuesFor(empty), empty)).toEqual(["games"]);
    const dup = { ...valid, entries: [valid.entries[0], valid.entries[0]] };
    expect(invalidFields(issuesFor(dup), dup)).toEqual(["games"]);
    const other = { ...valid, receipt_path: "submissions/ffffffff-ffff-4fff-8fff-ffffffffffff/receipt.jpg" };
    expect(invalidFields(issuesFor(other), other)).toEqual(["receipt"]);
  });

  it("drops issues the form cannot point at (honeypot, unknown game, non-object input)", () => {
    const bot = { ...valid, website: "http://spam" };
    expect(invalidFields(issuesFor(bot), bot)).toEqual([]);
    const unknownGame = { ...valid, entries: [{ game: "valorant" }] };
    // A discriminator miss is reported on the entry itself — nothing finer than "games".
    expect(invalidFields(issuesFor(unknownGame), unknownGame)).toEqual(["games"]);
    expect(invalidFields(issuesFor(null), null)).toEqual([]);
    expect(invalidFields([{ path: ["entries", 0, "steam_url"] }], { entries: "not-an-array" })).toEqual(["games"]);
  });
});

describe("rate budgets (campus NAT)", () => {
  it("prepare and submit use separate buckets so one registration costs one unit each", () => {
    expect(SCH_PREPARE_LIMIT.name).not.toBe(SCH_SUBMIT_LIMIT.name);
    expect(SCH_PREPARE_LIMIT.windowSec).toBe(3600);
    expect(SCH_SUBMIT_LIMIT.windowSec).toBe(3600);
  });

  it("allows at least twenty registrations per hour from one shared address", () => {
    expect(SCH_NAT_FACTOR).toBeGreaterThanOrEqual(1);
    expect(SCH_SUBMIT_LIMIT.max).toBe(SCH_LIMITS.submitPerHourPerIp * SCH_NAT_FACTOR);
    expect(SCH_SUBMIT_LIMIT.max).toBeGreaterThanOrEqual(20);
    expect(SCH_PREPARE_LIMIT.max).toBeGreaterThanOrEqual(SCH_SUBMIT_LIMIT.max);
  });
});

describe("classifyInsertError", () => {
  it("names the game from a (game, lower(email)) unique violation", () => {
    expect(
      classifyInsertError({
        code: "23505",
        details: "Key (game, lower(email))=(cs2, a@b.c) already exists.",
        message: 'duplicate key value violates unique constraint "sch_registrations_game_email_idx"',
      }),
    ).toEqual({ kind: "duplicate", game: "cs2" });
  });

  it("falls back to a null game when the key is not spelled out", () => {
    expect(classifyInsertError({ code: "23505", details: null, message: "duplicate key" })).toEqual({
      kind: "duplicate",
      game: null,
    });
  });

  it("recognises the (submission_id, game) replay index", () => {
    expect(
      classifyInsertError({
        code: "23505",
        details: "Key (submission_id, game)=(5f2c6e8e-1b8a-4c4a-9a9e-1f2e3d4c5b6a, cs2) already exists.",
        message: 'duplicate key value violates unique constraint "sch_registrations_submission_game_idx"',
      }),
    ).toEqual({ kind: "replay" });
    expect(
      classifyInsertError({ code: "23505", details: null, message: "… sch_registrations_submission_game_idx" }),
    ).toEqual({ kind: "replay" });
  });

  it("treats every other error as 'other'", () => {
    expect(classifyInsertError(null)).toEqual({ kind: "other" });
    expect(classifyInsertError({ code: "23503", details: "Key (game, lower(email))=(cs2, x) …" })).toEqual({ kind: "other" });
    expect(classifyInsertError({ code: "PGRST301" })).toEqual({ kind: "other" });
  });
});

describe("replayOutcome", () => {
  it("is 'none' without stored rows", () => {
    expect(replayOutcome([], "a@b.c")).toEqual({ kind: "none" });
  });

  it("returns the stored games again when the same person replays", () => {
    const rows = [
      { game: "cs2", email: "A@B.C" },
      { game: "dota2", email: "a@b.c" },
    ];
    expect(replayOutcome(rows, " a@b.c ")).toEqual({ kind: "replay", games: ["cs2", "dota2"] });
  });

  it("is a conflict when any stored row belongs to someone else", () => {
    const rows = [
      { game: "cs2", email: "a@b.c" },
      { game: "dota2", email: "other@b.c" },
    ];
    expect(replayOutcome(rows, "a@b.c")).toEqual({ kind: "conflict" });
  });
});

describe("accountNumber", () => {
  it("extracts only the account-like digit run and strips whitespace", () => {
    expect(accountNumber("Солонгос данс: 토스뱅크 1001-9949-6201")).toBe("1001-9949-6201");
    expect(accountNumber("Монгол данс: 450004000409071526 ХХБ")).toBe("450004000409071526");
    expect(accountNumber("IBAN 1234 5678 9012")).toBe("123456789012");
  });

  it("returns null for lines without an account number", () => {
    expect(accountNumber("Гүйлгээний утга дээр өөрийн бүтэн нэрээ оруулна уу.")).toBeNull();
    expect(accountNumber("Tel 010-12")).toBeNull();
    expect(accountNumber("")).toBeNull();
  });
});

describe("registration draft codec", () => {
  const now = 1_760_000_000_000;
  const submissionId = "5f2c6e8e-1b8a-4c4a-9a9e-1f2e3d4c5b6a";
  const base: Omit<SchDraft, "v" | "savedAt"> = {
    person: { full_name: "Бат Дорж", email: "bat@example.com", facebook: "fb.com/bat", phone: "" },
    games: ["cs2", "mobile_legends"],
    ml: { rank: "Epic", roles: ["Jungle"], in_game_id: "bat#123" },
    cs2: { premier_rank: "15000", steam_url: "https://steamcommunity.com/id/bat", faceit: "yes" },
    dota: { roles: [], rank: "", steam_url: "" },
    upload: {
      submissionId,
      path: receiptPath(submissionId, "image/png"),
      file: { name: "toss.png", size: 123_456, mime: "image/png" },
    },
  };

  it("round-trips answers and the uploaded-receipt bookkeeping", () => {
    const parsed = parseDraft(serialiseDraft(base, now), now + 1000);
    expect(parsed).not.toBeNull();
    expect(parsed!.person).toEqual(base.person);
    // Games come back in canonical order regardless of how they were saved.
    expect(parsed!.games).toEqual(["mobile_legends", "cs2"]);
    expect(parsed!.ml).toEqual(base.ml);
    expect(parsed!.cs2).toEqual(base.cs2);
    expect(parsed!.upload).toEqual(base.upload);
  });

  it("drops the upload part once it is older than the sweep floor but keeps the answers", () => {
    const parsed = parseDraft(serialiseDraft(base, now), now + SCH_DRAFT_UPLOAD_MAX_AGE_MS + 1);
    expect(parsed).not.toBeNull();
    expect(parsed!.upload).toBeNull();
    expect(parsed!.person.email).toBe("bat@example.com");
  });

  it("drops the whole draft when it is stale, from the future, or malformed", () => {
    expect(parseDraft(serialiseDraft(base, now), now + SCH_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(parseDraft(serialiseDraft(base, now + 120_000), now)).toBeNull();
    expect(parseDraft("not json", now)).toBeNull();
    expect(parseDraft(JSON.stringify({ v: 2, savedAt: now }), now)).toBeNull();
    expect(parseDraft(null, now)).toBeNull();
  });

  it("refuses an upload whose path does not belong to its submission id or has a bad mime", () => {
    const foreign = { ...base, upload: { ...base.upload!, path: receiptPath("00000000-0000-4000-8000-000000000000", "image/png") } };
    expect(parseDraft(serialiseDraft(foreign, now), now)!.upload).toBeNull();
    const badMime = { ...base, upload: { ...base.upload!, file: { ...base.upload!.file, mime: "image/gif" as never } } };
    expect(parseDraft(serialiseDraft(badMime, now), now)!.upload).toBeNull();
    const tooBig = { ...base, upload: { ...base.upload!, file: { ...base.upload!.file, size: 11 * 1024 * 1024 } } };
    expect(parseDraft(serialiseDraft(tooBig, now), now)!.upload).toBeNull();
  });

  it("ignores unknown games and non-string junk instead of throwing", () => {
    const raw = JSON.stringify({
      v: 1,
      savedAt: now,
      person: { full_name: 42, email: "x@y.z" },
      games: ["cs2", "valorant", 7],
      ml: { roles: ["Jungle", 3, null] },
    });
    const parsed = parseDraft(raw, now);
    expect(parsed!.person.full_name).toBe("");
    expect(parsed!.games).toEqual(["cs2"]);
    expect(parsed!.ml.roles).toEqual(["Jungle"]);
  });

  it("treats an untouched form as no draft", () => {
    const empty: Omit<SchDraft, "v" | "savedAt"> = {
      person: { full_name: "", email: "", facebook: "", phone: "" },
      games: [],
      ml: { rank: "", roles: [], in_game_id: "" },
      cs2: { premier_rank: "", steam_url: "", faceit: "" },
      dota: { roles: [], rank: "", steam_url: "" },
      upload: null,
    };
    expect(isDraftEmpty({ v: 1, savedAt: now, ...empty })).toBe(true);
    expect(parseDraft(serialiseDraft(empty, now), now)).toBeNull();
  });
});
