/** @jest-environment node */
import { allFlags, flag, FLAGS } from "@/lib/flags";

describe("feature flags", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore only the env vars we touched. Anything else might be set
    // by the test runner and resetting it would break sibling tests.
    for (const def of Object.values(FLAGS)) {
      const key = def.env;
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("returns the documented default when no env var is set", () => {
    delete process.env[FLAGS.wall_subdomain.env];
    expect(flag("wall_subdomain")).toBe(FLAGS.wall_subdomain.default);
  });

  it("parses truthy strings as true", () => {
    for (const v of ["1", "true", "TRUE", "yes", "On", "y"]) {
      process.env[FLAGS.edge_detect_onnx.env] = v;
      expect(flag("edge_detect_onnx")).toBe(true);
    }
  });

  it("parses falsy strings as false", () => {
    for (const v of ["0", "false", "FALSE", "no", "off", "n"]) {
      process.env[FLAGS.wall_subdomain.env] = v;
      expect(flag("wall_subdomain")).toBe(false);
    }
  });

  it("falls back to default on unparseable values", () => {
    process.env[FLAGS.wall_subdomain.env] = "banana";
    expect(flag("wall_subdomain")).toBe(FLAGS.wall_subdomain.default);
  });

  it("allFlags() exposes every flag with shape {value, envVar, default}", () => {
    const snap = allFlags();
    for (const name of Object.keys(FLAGS) as (keyof typeof FLAGS)[]) {
      expect(snap[name]).toBeDefined();
      expect(typeof snap[name].value).toBe("boolean");
      expect(typeof snap[name].envVar).toBe("string");
      expect(typeof snap[name].default).toBe("boolean");
    }
  });

  it("FLAGS registry uses MONGOLZ_FF_ prefix consistently", () => {
    for (const def of Object.values(FLAGS)) {
      expect(def.env.startsWith("MONGOLZ_FF_")).toBe(true);
    }
  });
});
