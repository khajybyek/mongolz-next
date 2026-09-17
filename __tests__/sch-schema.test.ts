import {
  CS2_UNKNOWN_SCORE,
  DOTA_RANKS,
  ML_RANKS,
  RECEIPT_MAX_BYTES,
  RECEIPT_UPLOAD_MIMES,
  RECEIPT_PATH_RE,
  SCH_DRAW_STATUSES,
  SCH_GAMES,
  UUID_V4_RE,
  cs2PremierScore,
  isReceiptMime,
  isReceiptUploadMime,
  isSchGame,
  isSchStatus,
  rankScore,
  receiptPath,
  referenceCode,
  registrationRow,
  schSubmissionSchema,
  type SchGameEntry,
} from "@/lib/sch/schema";

const SUBMISSION_ID = "0f8a2b6e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

/** Loosely typed so tests can mutate any field into an invalid shape. */
type LooseSubmission = {
  submission_id: string;
  receipt_path: string;
  person: Record<string, string>;
  entries: Record<string, unknown>[];
  website?: string;
};

/** A valid Mobile Legends + CS2 submission; tests spread over it. */
function validSubmission(): LooseSubmission {
  return {
    submission_id: SUBMISSION_ID,
    receipt_path: `submissions/${SUBMISSION_ID}/receipt.jpg`,
    person: {
      full_name: "Бат Зориг",
      email: "Zorig@Example.com",
      facebook: "fb.com/zorig",
      phone: "",
    },
    entries: [
      { game: "mobile_legends", rank: "Epic", roles: ["Jungle", "Roamer"], in_game_id: "Zorig#1234" },
      { game: "cs2", premier_rank: "15000", steam_url: "steamcommunity.com/id/zorig", faceit: "yes" },
    ],
    website: "",
  };
}

describe("rank ladders", () => {
  it("scores Mobile Legends ranks by ladder position (0–100)", () => {
    expect(rankScore("mobile_legends", "Warrior")).toBe(10);
    expect(rankScore("mobile_legends", "Epic")).toBe(50);
    expect(rankScore("mobile_legends", "Mythical Immortal")).toBe(100);
    const scores = ML_RANKS.map((r) => rankScore("mobile_legends", r));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
  });

  it("scores Dota 2 medals by ladder position (0–100)", () => {
    expect(rankScore("dota2", "Herald")).toBe(13);
    expect(rankScore("dota2", "Immortal")).toBe(100);
    const scores = DOTA_RANKS.map((r) => rankScore("dota2", r));
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeGreaterThan(scores[i - 1]);
    expect(scores.every((s) => s >= 0 && s <= 100)).toBe(true);
  });

  it("gives unknown or missing labels a score of 0 on ladder games", () => {
    expect(rankScore("mobile_legends", "Immortal")).toBe(0); // a Dota medal, not an ML rank
    expect(rankScore("dota2", null)).toBe(0);
    expect(rankScore("dota2", undefined)).toBe(0);
    expect(rankScore("mobile_legends", "")).toBe(0);
  });
});

describe("cs2PremierScore", () => {
  it("maps blank / unparsable / non-positive input to the unknown score", () => {
    expect(cs2PremierScore("")).toBe(CS2_UNKNOWN_SCORE);
    expect(cs2PremierScore(null)).toBe(CS2_UNKNOWN_SCORE);
    expect(cs2PremierScore(undefined)).toBe(CS2_UNKNOWN_SCORE);
    expect(cs2PremierScore("unranked")).toBe(CS2_UNKNOWN_SCORE);
    expect(cs2PremierScore("0")).toBe(CS2_UNKNOWN_SCORE);
  });

  it("scales the rating against 30 000 and clamps to 1–100", () => {
    expect(cs2PremierScore("15000")).toBe(50);
    expect(cs2PremierScore("15,000")).toBe(50);
    expect(cs2PremierScore("Premier 15 000")).toBe(50);
    expect(cs2PremierScore("30000")).toBe(100);
    expect(cs2PremierScore("99999")).toBe(100); // clamp high
    expect(cs2PremierScore("100")).toBe(1); // clamp low (0.33 would round to 0)
    expect(cs2PremierScore("3000")).toBe(10);
  });

  it("rankScore for CS2 prefers answers.premier_rank over the label", () => {
    expect(rankScore("cs2", null, { premier_rank: "15000" })).toBe(50);
    expect(rankScore("cs2", "Premier 15000")).toBe(50);
    expect(rankScore("cs2", "Premier 15000", { premier_rank: "3000" })).toBe(10);
    expect(rankScore("cs2", null, { premier_rank: 15000 })).toBe(CS2_UNKNOWN_SCORE); // non-string ignored
    expect(rankScore("cs2", null)).toBe(CS2_UNKNOWN_SCORE);
  });
});

describe("guards", () => {
  it("isSchGame / isSchStatus / draw statuses", () => {
    for (const g of SCH_GAMES) expect(isSchGame(g)).toBe(true);
    expect(isSchGame("valorant")).toBe(false);
    expect(isSchGame(undefined)).toBe(false);
    expect(isSchStatus("paid")).toBe(true);
    expect(isSchStatus("PAID")).toBe(false);
    expect(SCH_DRAW_STATUSES).toEqual(["paid"]);
  });

  it("isReceiptMime accepts only the allow-listed image types", () => {
    expect(isReceiptMime("image/jpeg")).toBe(true);
    expect(isReceiptMime("image/png")).toBe(true);
    expect(isReceiptMime("image/webp")).toBe(true);
    expect(isReceiptMime("image/heic")).toBe(true);
    expect(isReceiptMime("image/gif")).toBe(false);
    expect(isReceiptMime("application/pdf")).toBe(false);
    expect(isReceiptMime("IMAGE/JPEG")).toBe(false);
    expect(isReceiptMime("constructor")).toBe(false); // prototype keys are not mimes
    expect(isReceiptMime("toString")).toBe(false);
    expect(isReceiptMime(42)).toBe(false);
    expect(isReceiptMime(null)).toBe(false);
    expect(RECEIPT_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it("upload mimes exclude HEIC while the stored-mime list keeps it for legacy rows", () => {
    // No browser but Safari decodes HEIC, so the organiser could never view
    // such a receipt; new uploads are JPG/PNG/WebP only (iOS converts).
    expect([...RECEIPT_UPLOAD_MIMES]).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const m of RECEIPT_UPLOAD_MIMES) {
      expect(isReceiptUploadMime(m)).toBe(true);
      expect(isReceiptMime(m)).toBe(true);
    }
    expect(isReceiptUploadMime("image/heic")).toBe(false);
    expect(isReceiptMime("image/heic")).toBe(true);
    expect(isReceiptUploadMime("image/gif")).toBe(false);
    expect(isReceiptUploadMime("constructor")).toBe(false);
    expect(isReceiptUploadMime(null)).toBe(false);
  });

  it("UUID_V4_RE matches canonical uuids in either case", () => {
    expect(UUID_V4_RE.test(SUBMISSION_ID)).toBe(true);
    expect(UUID_V4_RE.test(SUBMISSION_ID.toUpperCase())).toBe(true);
    expect(UUID_V4_RE.test(SUBMISSION_ID.replace(/-/g, ""))).toBe(false);
    expect(UUID_V4_RE.test(`${SUBMISSION_ID}x`)).toBe(false);
    expect(UUID_V4_RE.test("not-a-uuid")).toBe(false);
  });
});

describe("receipt paths", () => {
  it("receiptPath builds the canonical object key and lower-cases the id", () => {
    expect(receiptPath(SUBMISSION_ID, "image/jpeg")).toBe(`submissions/${SUBMISSION_ID}/receipt.jpg`);
    expect(receiptPath(SUBMISSION_ID.toUpperCase(), "image/png")).toBe(`submissions/${SUBMISSION_ID}/receipt.png`);
    expect(receiptPath(SUBMISSION_ID, "image/webp")).toBe(`submissions/${SUBMISSION_ID}/receipt.webp`);
    expect(receiptPath(SUBMISSION_ID, "image/heic")).toBe(`submissions/${SUBMISSION_ID}/receipt.heic`);
  });

  it("every receiptPath output matches RECEIPT_PATH_RE and captures the id", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/heic"] as const) {
      const path = receiptPath(SUBMISSION_ID, mime);
      const m = RECEIPT_PATH_RE.exec(path);
      expect(m).not.toBeNull();
      expect(m?.[1]).toBe(SUBMISSION_ID);
    }
    expect(RECEIPT_PATH_RE.exec(`submissions/${SUBMISSION_ID}/receipt.png`)?.[2]).toBe("png");
  });

  it("RECEIPT_PATH_RE rejects traversal, foreign prefixes, other extensions and upper-case ids", () => {
    const bad = [
      `submissions/${SUBMISSION_ID}/receipt.gif`,
      `submissions/${SUBMISSION_ID}/receipt.jpg.exe`,
      `submissions/${SUBMISSION_ID}/receipt`,
      `submissions/${SUBMISSION_ID}/other.jpg`,
      `submissions/${SUBMISSION_ID.toUpperCase()}/receipt.jpg`,
      `submissions/${SUBMISSION_ID}/../receipt.jpg`,
      `../submissions/${SUBMISSION_ID}/receipt.jpg`,
      `/submissions/${SUBMISSION_ID}/receipt.jpg`,
      `faces/${SUBMISSION_ID}/receipt.jpg`,
      `submissions/not-a-uuid/receipt.jpg`,
      `submissions/${SUBMISSION_ID}/receipt.jpg\n`,
      "",
    ];
    for (const p of bad) expect(RECEIPT_PATH_RE.test(p)).toBe(false);
  });
});

describe("schSubmissionSchema", () => {
  it("accepts a valid Mobile Legends + CS2 submission and normalises it", () => {
    const parsed = schSubmissionSchema.safeParse(validSubmission());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.submission_id).toBe(SUBMISSION_ID);
    expect(parsed.data.receipt_path).toBe(`submissions/${SUBMISSION_ID}/receipt.jpg`);
    expect(parsed.data.person.email).toBe("zorig@example.com");
    expect(parsed.data.person.phone).toBeNull();
    expect(parsed.data.entries).toHaveLength(2);
    const cs2 = parsed.data.entries[1];
    expect(cs2.game).toBe("cs2");
    if (cs2.game === "cs2") expect(cs2.steam_url).toBe("https://steamcommunity.com/id/zorig");
  });

  it("lower-cases an upper-case submission id and still matches the receipt path", () => {
    const input = validSubmission();
    input.submission_id = SUBMISSION_ID.toUpperCase();
    const parsed = schSubmissionSchema.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.submission_id).toBe(SUBMISSION_ID);
  });

  it("requires submission_id to be a uuid", () => {
    const input = { ...validSubmission(), submission_id: "abc" };
    expect(schSubmissionSchema.safeParse(input).success).toBe(false);
    const { submission_id: _omit, ...missing } = validSubmission();
    void _omit;
    expect(schSubmissionSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a receipt_path that belongs to another submission", () => {
    const other = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
    const input = { ...validSubmission(), receipt_path: `submissions/${other}/receipt.jpg` };
    const parsed = schSubmissionSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.message === "receipt_mismatch");
      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["receipt_path"]);
    }
  });

  it("rejects malformed receipt paths before the refine runs", () => {
    for (const receipt_path of [
      `submissions/${SUBMISSION_ID}/receipt.gif`,
      `submissions/${SUBMISSION_ID}/../receipt.jpg`,
      `receipt.jpg`,
      "",
    ]) {
      expect(schSubmissionSchema.safeParse({ ...validSubmission(), receipt_path }).success).toBe(false);
    }
  });

  it("rejects the same game twice", () => {
    const input = validSubmission();
    input.entries = [input.entries[0], { ...input.entries[0], in_game_id: "Other#1" }];
    const parsed = schSubmissionSchema.safeParse(input);
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.some((i) => i.message === "duplicate_game")).toBe(true);
  });

  it("rejects a bad Steam URL", () => {
    for (const steam_url of ["https://example.com/id/zorig", "zorig", "steamcommunity.com/zorig", "steamcommunity.com/id/"]) {
      const input = validSubmission();
      input.entries[1] = { ...input.entries[1], steam_url };
      const parsed = schSubmissionSchema.safeParse(input);
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues.some((i) => i.message === "steam_url")).toBe(true);
    }
  });

  it("rejects a filled honeypot", () => {
    expect(schSubmissionSchema.safeParse({ ...validSubmission(), website: "http://spam.example" }).success).toBe(false);
    const { website: _omit, ...noHoneypot } = validSubmission();
    void _omit;
    expect(schSubmissionSchema.safeParse(noHoneypot).success).toBe(true);
  });

  it("rejects empty roles, unknown ranks, empty entries and too many entries", () => {
    const noRoles = validSubmission();
    noRoles.entries[0] = { ...noRoles.entries[0], roles: [] };
    expect(schSubmissionSchema.safeParse(noRoles).success).toBe(false);

    const badRank = validSubmission();
    badRank.entries[0] = { ...badRank.entries[0], rank: "Immortal" };
    expect(schSubmissionSchema.safeParse(badRank).success).toBe(false);

    expect(schSubmissionSchema.safeParse({ ...validSubmission(), entries: [] }).success).toBe(false);

    const dota = { game: "dota2", rank: "Ancient", roles: ["Position 1 (Carry)"], steam_url: "https://steamcommunity.com/profiles/76561198000000000" };
    const four = validSubmission();
    four.entries = [...four.entries, dota, { ...dota }];
    expect(schSubmissionSchema.safeParse(four).success).toBe(false);
    const three = validSubmission();
    three.entries = [...three.entries, dota];
    expect(schSubmissionSchema.safeParse(three).success).toBe(true);
  });

  it("validates the person block", () => {
    const short = validSubmission();
    short.person = { ...short.person, full_name: "A" };
    expect(schSubmissionSchema.safeParse(short).success).toBe(false);
    const email = validSubmission();
    email.person = { ...email.person, email: "not-an-email" };
    expect(schSubmissionSchema.safeParse(email).success).toBe(false);
    const fb = validSubmission();
    fb.person = { ...fb.person, facebook: "" };
    expect(schSubmissionSchema.safeParse(fb).success).toBe(false);
  });
});

describe("registrationRow", () => {
  it("shapes a Mobile Legends entry", () => {
    const entry: SchGameEntry = { game: "mobile_legends", rank: "Legend", roles: ["Mid Lane"], in_game_id: "Zorig#1" };
    expect(registrationRow(entry)).toEqual({
      game: "mobile_legends",
      in_game_id: "Zorig#1",
      rank_label: "Legend",
      rank_score: 60,
      roles: ["Mid Lane"],
      answers: {},
    });
  });

  it("shapes a Dota 2 entry with the Steam URL as the in-game id", () => {
    const entry: SchGameEntry = {
      game: "dota2",
      rank: "Divine",
      roles: ["Position 2 (Midlaner)", "Position 4 (Soft Support)"],
      steam_url: "https://steamcommunity.com/id/zorig",
    };
    const row = registrationRow(entry);
    expect(row).toEqual({
      game: "dota2",
      in_game_id: "https://steamcommunity.com/id/zorig",
      rank_label: "Divine",
      rank_score: 88,
      roles: ["Position 2 (Midlaner)", "Position 4 (Soft Support)"],
      answers: {},
    });
    expect(row.roles).not.toBe(entry.roles); // copied, not aliased
  });

  it("shapes a CS2 entry with premier + faceit in answers", () => {
    const withRank: SchGameEntry = { game: "cs2", premier_rank: "15000", steam_url: "https://steamcommunity.com/id/zorig", faceit: "yes" };
    expect(registrationRow(withRank)).toEqual({
      game: "cs2",
      in_game_id: "https://steamcommunity.com/id/zorig",
      rank_label: "Premier 15000",
      rank_score: 50,
      roles: [],
      answers: { premier_rank: "15000", faceit: "yes" },
    });
    const noRank: SchGameEntry = { game: "cs2", premier_rank: null, steam_url: "https://steamcommunity.com/id/zorig", faceit: "no" };
    const row = registrationRow(noRank);
    expect(row.rank_label).toBeNull();
    expect(row.rank_score).toBe(CS2_UNKNOWN_SCORE);
    expect(row.answers).toEqual({ premier_rank: null, faceit: "no" });
  });

  it("rank_score is always within 0–100", () => {
    const parsed = schSubmissionSchema.safeParse(validSubmission());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    for (const e of parsed.data.entries) {
      const s = registrationRow(e).rank_score;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("referenceCode", () => {
  it("is the first 8 hex characters of the submission id, upper-cased", () => {
    expect(referenceCode(SUBMISSION_ID)).toBe("0F8A2B6E");
    expect(referenceCode(SUBMISSION_ID)).toHaveLength(8);
  });
});
