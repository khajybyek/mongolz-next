/**
 * The PWA manifest declared /icon.png as 512x512 while the file is 64x64,
 * and there was no icon >= 192px, so the app was not installable; and
 * /favicon.ico had no file (a steady stream of 404s in production logs).
 * Every declared size must match the pixels actually served.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import manifest from "@/app/manifest";

const ROOT = path.join(__dirname, "..");

/** Width/height from a PNG's IHDR chunk. */
function pngSize(file: string): string {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

/** app/<name>.png is served at /<name>.png; everything else from public/. */
function servedFile(src: string): string {
  const appFile = path.join(ROOT, "app", src);
  return existsSync(appFile) ? appFile : path.join(ROOT, "public", src);
}

describe("PWA manifest icons", () => {
  const icons = manifest().icons ?? [];

  it("declares sizes that match the real files", () => {
    for (const icon of icons) {
      expect(`${icon.src} ${pngSize(servedFile(icon.src))}`).toBe(`${icon.src} ${icon.sizes}`);
    }
  });

  it("includes the 192px and 512px icons installability requires", () => {
    const sizes = icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("ships a favicon.ico", () => {
    const ico = readFileSync(path.join(ROOT, "app/favicon.ico"));
    // ICONDIR: reserved 0, type 1 (icon), count >= 1.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
  });
});
