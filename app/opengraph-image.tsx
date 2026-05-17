import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "MONGOLZ Security — Multi-authority masking + reveal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(circle at 30% 30%, rgba(0,212,255,0.18), transparent 55%), radial-gradient(circle at 75% 80%, rgba(170,90,255,0.12), transparent 55%), #08090d",
          color: "#f4f4f5",
          fontFamily: "Inter, -apple-system, system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "16px",
            padding: "10px 18px",
            borderRadius: "999px",
            border: "1px solid rgba(0,212,255,0.35)",
            color: "#00d4ff",
            fontSize: "20px",
            letterSpacing: "0.18em",
            marginBottom: "40px",
            width: "fit-content",
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: "#00d4ff",
              boxShadow: "0 0 12px rgba(0,212,255,0.7)",
            }}
          />
          2026-01-CD-03-07
        </div>
        <div
          style={{
            fontSize: "84px",
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            marginBottom: "28px",
          }}
        >
          MONGOLZ Security
        </div>
        <div
          style={{
            fontSize: "34px",
            lineHeight: 1.3,
            color: "#a1a1aa",
            maxWidth: "950px",
          }}
        >
          Multi-authority masking + reveal · intelligent network camera & integrated control server
        </div>
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            left: "80px",
            right: "80px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            color: "#52525b",
            fontSize: "22px",
          }}
        >
          <span>mongolz.vercel.app</span>
          <span style={{ color: "#71717a" }}>
            Next.js 16 · Supabase · Railway · Vercel
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
