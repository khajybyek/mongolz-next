import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openEvidenceZip } from "../lib/evidence-encryption";

const [inputArg, outputArg] = process.argv.slice(2);
const passphrase = process.env.EVIDENCE_PACKAGE_PASSPHRASE ?? "";
if (!inputArg || !outputArg || passphrase.length < 12) {
  console.error("Usage: EVIDENCE_PACKAGE_PASSPHRASE='<passphrase>' npm run evidence:decrypt -- <package.zip.enc> <output.zip>");
  process.exit(2);
}
const input = path.resolve(inputArg);
const output = path.resolve(outputArg);
const { zip, header } = openEvidenceZip(readFileSync(input), passphrase);
writeFileSync(output, zip, { mode: 0o600 });
console.log(`Evidence ZIP decrypted: incident=${header.incident_id} manifest=${header.manifest_sha256} output=${output}`);
