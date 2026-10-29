/**
 * Byte-range behaviour of /api/recordings/[id]/view. Safari/iOS probe a
 * <video> source with `Range: bytes=0-1` and refuse to play unless the answer
 * is a 206; seeking in every browser relies on it too. The route used to drop
 * the Range header and always answer 200 without Content-Range.
 */
import { NextRequest } from "next/server";

const recordAccess = jest.fn(async () => {});

jest.mock("@/lib/supabase/auth", () => ({
  requireUserApi: jest.fn(async () => ({ user: { id: "u-1", email: "u@x" }, profile: { role: "viewer" } })),
  isAuthErr: (r: unknown) => typeof r === "object" && r !== null && "error" in r,
}));

jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: REC, has_original: true } }) }),
      }),
    }),
  }),
}));

jest.mock("@/lib/audit", () => ({
  recordAccess: (...args: unknown[]) => (recordAccess as unknown as (...a: unknown[]) => Promise<void>)(...args),
  READ_ACTIONS: { RECORDING_VIEWED: "RECORDING_VIEWED" },
  ACCESS_THROTTLE_MS: 300_000,
}));

const REC = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

function call(headers: Record<string, string> = {}) {
  process.env.NEXT_PUBLIC_ML_SERVICE_URL = "https://ml.test";
  process.env.ML_SERVICE_TOKEN = "tok";
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GET } = require("@/app/api/recordings/[id]/view/route") as {
    GET: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  };
  return GET(new NextRequest(`http://localhost/api/recordings/${REC}/view`, { headers }), {
    params: Promise.resolve({ id: REC }),
  });
}

function sentHeaders(): Record<string, string> {
  const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

describe("GET /api/recordings/[id]/view — byte ranges", () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    recordAccess.mockClear();
    global.fetch = jest.fn() as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it("forwards Range and answers 206 with the upstream Content-Range", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(new Uint8Array([0, 0]), {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-1/4096",
          "content-length": "2",
          "accept-ranges": "bytes",
        },
      }),
    );
    const res = await call({ Range: "bytes=0-1" });
    expect(sentHeaders().Range).toBe("bytes=0-1");
    expect(sentHeaders().Authorization).toBe("Bearer tok");
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-1/4096");
    expect(res.headers.get("content-length")).toBe("2");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    // No browser cache: a tightened privacy policy (consent gate, schedule)
    // must apply to the very next request, not after a cached copy expires.
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(recordAccess).toHaveBeenCalledTimes(1);
  });

  it("advertises Accept-Ranges on a full 200 and sends no Range upstream when none was asked", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(new Uint8Array([0, 0, 0, 1]), { status: 200, headers: { "content-length": "4" } }),
    );
    const res = await call();
    expect(sentHeaders().Range).toBeUndefined();
    expect(res.status).toBe(200);
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("4");
  });

  it("passes a 416 through with its Content-Range and writes no audit row", async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(null, { status: 416, headers: { "content-range": "bytes */4096" } }),
    );
    const res = await call({ Range: "bytes=999999-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */4096");
    expect(recordAccess).not.toHaveBeenCalled();
  });
});
