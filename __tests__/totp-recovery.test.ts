import { generateRecoveryCodes, hashCode, consumeRecoveryCode } from "@/lib/totp-recovery";

describe("totp-recovery", () => {
  it("generates 10 unique codes by default", () => {
    const { plaintext, hashes } = generateRecoveryCodes();
    expect(plaintext).toHaveLength(10);
    expect(hashes).toHaveLength(10);
    expect(new Set(plaintext).size).toBe(10);
    expect(new Set(hashes).size).toBe(10);
  });

  it("formats codes as XXXXX-XXXXX", () => {
    const { plaintext } = generateRecoveryCodes(3);
    for (const c of plaintext) {
      expect(c).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    }
  });

  it("hashCode is deterministic + case/separator-insensitive", () => {
    const a = hashCode("ABCDE-FGHJK");
    const b = hashCode("abcde-fghjk");
    const c = hashCode("ABCDEFGHJK");
    const d = hashCode("ABCDE FGHJK");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a).toBe(d);
  });

  it("consumes a valid code and removes it", () => {
    const { plaintext, hashes } = generateRecoveryCodes(5);
    const next = consumeRecoveryCode(hashes, plaintext[2]);
    expect(next).not.toBeNull();
    expect(next).toHaveLength(4);
    expect(next).not.toContain(hashes[2]);
  });

  it("rejects unknown codes", () => {
    const { hashes } = generateRecoveryCodes(5);
    expect(consumeRecoveryCode(hashes, "AAAAA-BBBBB")).toBeNull();
  });

  it("rejects already-consumed code on second use", () => {
    const { plaintext, hashes } = generateRecoveryCodes(3);
    const after1 = consumeRecoveryCode(hashes, plaintext[0]);
    const after2 = consumeRecoveryCode(after1!, plaintext[0]);
    expect(after2).toBeNull();
  });
});
