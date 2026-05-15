import { randomBytes } from "crypto";

const TEST_KEY = randomBytes(32).toString("base64");

beforeAll(() => {
  process.env.CAMERA_URL_KEY = TEST_KEY;
});

import {
  encryptCameraUrl,
  decryptCameraUrl,
  isEncrypted,
  protectCameraUrlForStorage,
  unwrapCameraUrlForRuntime,
} from "@/lib/camera-crypto";

describe("camera-crypto", () => {
  const url = "rtsp://admin:pass@192.168.1.100:554/stream1";

  it("encrypts and decrypts a URL correctly", () => {
    const encrypted = encryptCameraUrl(url);
    expect(encrypted).not.toBe(url);
    expect(encrypted.startsWith("enc:")).toBe(true);

    const decrypted = decryptCameraUrl(encrypted);
    expect(decrypted).toBe(url);
  });

  it("isEncrypted detects encrypted strings", () => {
    const encrypted = encryptCameraUrl(url);
    expect(isEncrypted(encrypted)).toBe(true);
    expect(isEncrypted(url)).toBe(false);
  });

  it("decryptCameraUrl passes through plaintext", () => {
    expect(decryptCameraUrl(url)).toBe(url);
  });

  it("produces different ciphertexts for the same input (random IV)", () => {
    const a = encryptCameraUrl(url);
    const b = encryptCameraUrl(url);
    expect(a).not.toBe(b);
  });

  it("rejects tampered ciphertext", () => {
    const encrypted = encryptCameraUrl(url);
    const tampered = encrypted.slice(0, -2) + "XX";
    expect(() => decryptCameraUrl(tampered)).toThrow();
  });

  it("fails closed for new camera URLs when encryption key is missing", () => {
    const oldKey = process.env.CAMERA_URL_KEY;
    const oldAllow = process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
    delete process.env.CAMERA_URL_KEY;
    delete process.env.ALLOW_PLAINTEXT_CAMERA_URLS;

    try {
      expect(() => protectCameraUrlForStorage(url)).toThrow("CAMERA_URL_KEY env not set");
    } finally {
      if (oldKey === undefined) {
        delete process.env.CAMERA_URL_KEY;
      } else {
        process.env.CAMERA_URL_KEY = oldKey;
      }
      if (oldAllow === undefined) {
        delete process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
      } else {
        process.env.ALLOW_PLAINTEXT_CAMERA_URLS = oldAllow;
      }
    }
  });

  it("allows plaintext only with explicit local opt-in", () => {
    const oldKey = process.env.CAMERA_URL_KEY;
    const oldAllow = process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
    delete process.env.CAMERA_URL_KEY;
    process.env.ALLOW_PLAINTEXT_CAMERA_URLS = "1";

    try {
      expect(protectCameraUrlForStorage(url)).toBe(url);
    } finally {
      if (oldKey === undefined) {
        delete process.env.CAMERA_URL_KEY;
      } else {
        process.env.CAMERA_URL_KEY = oldKey;
      }
      if (oldAllow === undefined) {
        delete process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
      } else {
        process.env.ALLOW_PLAINTEXT_CAMERA_URLS = oldAllow;
      }
    }
  });

  it("does not unwrap plaintext URLs at runtime without explicit local opt-in", () => {
    const oldAllow = process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
    delete process.env.ALLOW_PLAINTEXT_CAMERA_URLS;

    try {
      expect(() => unwrapCameraUrlForRuntime(url)).toThrow("PLAINTEXT_CAMERA_URL_NOT_ALLOWED");
    } finally {
      if (oldAllow === undefined) {
        delete process.env.ALLOW_PLAINTEXT_CAMERA_URLS;
      } else {
        process.env.ALLOW_PLAINTEXT_CAMERA_URLS = oldAllow;
      }
    }
  });

  it("unwraps encrypted URLs at runtime", () => {
    const encrypted = encryptCameraUrl(url);
    expect(unwrapCameraUrlForRuntime(encrypted)).toBe(url);
  });
});
