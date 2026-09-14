import { openRevealReference, revealReferenceMatchesScope, sealRevealReference } from "@/lib/reveal-reference";

const oldKey = process.env.CAMERA_URL_KEY;
const oldPrev = process.env.CAMERA_URL_KEY_PREV;
afterEach(() => { process.env.CAMERA_URL_KEY = oldKey; process.env.CAMERA_URL_KEY_PREV = oldPrev; });
it("seals references, binds them to the job, and detects tampering", () => {
  process.env.CAMERA_URL_KEY = Buffer.alloc(32, 1).toString("base64");
  const sealed = sealRevealReference("job-a", Buffer.from("image fixture"), "image/jpeg");
  expect(openRevealReference("job-a", sealed).bytes.toString()).toBe("image fixture");
  expect(() => openRevealReference("job-b", sealed)).toThrow();
  const changed = Buffer.from(sealed, "base64"); changed[30] ^= 1;
  expect(() => openRevealReference("job-a", changed.toString("base64"))).toThrow();
});
it("reads with the previous rotation key without plaintext fallback", () => {
  process.env.CAMERA_URL_KEY = Buffer.alloc(32, 1).toString("base64");
  const sealed = sealRevealReference("job", Buffer.from("fixture"), "image/png");
  process.env.CAMERA_URL_KEY_PREV = process.env.CAMERA_URL_KEY;
  process.env.CAMERA_URL_KEY = Buffer.alloc(32, 2).toString("base64");
  expect(openRevealReference("job", sealed).mime).toBe("image/png");
  delete process.env.CAMERA_URL_KEY_PREV;
  expect(() => openRevealReference("job", sealed)).toThrow();
});

it("checks the decrypted bytes against the immutable upload scope", () => {
  const bytes = Buffer.from("reference fixture");
  const hash = "453e5597b0230d421919767dcb7420064859ed53f1c3cbf5e7d523edb6f592f9";
  const scope = {
    version: 1,
    recording: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", filename: "fixture.mp4", duration_sec: 10 },
    method: "upload",
    targets: [{ id: hash, label: "fixture.jpg" }],
    threshold: 0.45,
    start_sec: null,
    end_sec: null,
    reference_sha256: hash,
  };
  expect(revealReferenceMatchesScope(scope, bytes)).toBe(true);
  expect(revealReferenceMatchesScope(scope, Buffer.from("different"))).toBe(false);
  expect(revealReferenceMatchesScope({ ...scope, method: "suspect" }, bytes)).toBe(false);
});
