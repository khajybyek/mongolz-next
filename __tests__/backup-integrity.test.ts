import { createHash } from "node:crypto";
import { validateBackupIntegrity, type BackupManifest } from "@/lib/backup-integrity";

function fixture() {
  const files: Record<string, Buffer> = {
    "tables/faces.json": Buffer.from('[{"id":"face"}]'),
    "buckets/faces.manifest.json": Buffer.from('{"objects":[{"path":"face.enc"}],"total_objects":1,"complete":true}'),
  };
  const manifest: BackupManifest = {
    format: "mongolz-backup/3", complete: true,
    tables: { faces: { rows: 1 } }, buckets: { faces: { objects: 1 } },
    file_sha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")])),
  };
  return { files, manifest, check: () => validateBackupIntegrity(manifest, (p) => { if (!files[p]) throw Error("missing"); return files[p]; }) };
}

it("accepts complete matching files and counts", () => expect(fixture().check()).toEqual([]));
it("rejects a truncated legacy export despite restorable columns", () => {
  const f = fixture(); f.manifest.format = "mongolz-backup/2"; f.manifest.tables!.faces.truncated = true;
  expect(f.check()).toContain("tables/faces.json: incomplete export.");
});
it("rejects corruption even when JSON and row count remain valid", () => {
  const f = fixture(); f.files["tables/faces.json"] = Buffer.from('[{"id":"changed"}]');
  expect(f.check()).toContain("tables/faces.json: checksum missing or mismatched.");
});
it("rejects missing bucket files before restore", () => {
  const f = fixture(); delete f.files["buckets/faces.manifest.json"];
  expect(f.check()).toContain("buckets/faces.manifest.json: missing or invalid file.");
});
it("rejects mismatched counts, incomplete manifests and absent checksums", () => {
  const f = fixture(); f.manifest.tables!.faces.rows = 50001; f.manifest.complete = false; f.manifest.file_sha256 = {};
  expect(f.check()).toEqual(expect.arrayContaining(["Export is incomplete.", "tables/faces.json: exported count does not match manifest.", "tables/faces.json: checksum missing or mismatched."]));
});
it("refuses an unverified missing manifest", () => expect(validateBackupIntegrity(null, () => Buffer.alloc(0))).not.toEqual([]));
