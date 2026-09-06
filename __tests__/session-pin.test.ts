import { networkBucket } from "@/lib/auth/session-pin";

describe("session-pin networkBucket", () => {
  it("buckets IPv4 by /16", () => {
    expect(networkBucket("203.0.113.42")).toBe("203.0");
    expect(networkBucket("203.0.7.1")).toBe("203.0");
    expect(networkBucket("10.99.1.1")).toBe("10.99");
  });

  it("buckets IPv6 by /48 after expansion", () => {
    expect(networkBucket("2001:db8::1")).toBe("2001:db8:0");
    expect(networkBucket("2001:db8:0:1234::1")).toBe("2001:db8:0");
    expect(networkBucket("2001:0db8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8:0");
    expect(networkBucket("2001:db8:1::1")).not.toBe(networkBucket("2001:db8:2::1"));
  });

  it("treats IPv4-mapped IPv6 as the embedded IPv4", () => {
    expect(networkBucket("::ffff:203.0.113.42")).toBe("203.0");
    expect(networkBucket("::ffff:cb00:712a")).toBe("203.0");
  });

  it("is stable for junk and empty input", () => {
    expect(networkBucket("")).toBe("");
    expect(networkBucket("not-an-ip")).toBe("not-an-ip");
    expect(networkBucket("fe80::1%en0")).toBe("fe80:0:0");
  });
});
