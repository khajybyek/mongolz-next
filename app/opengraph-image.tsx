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
          padding: "96px",
          background: "#08090d",
          color: "#f4f4f5",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "14px",
            color: "#00d4ff",
            fontSize: "22px",
            letterSpacing: "0.18em",
            marginBottom: "36px",
          }}
        >
          <div
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "999px",
              background: "#00d4ff",
            }}
          />
          <div>2026-01-CD-03-07</div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "92px",
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            marginBottom: "32px",
          }}
        >
          MONGOLZ Security
        </div>
        <div
          style={{
            display: "flex",
            fontSize: "36px",
            lineHeight: 1.3,
            color: "#a1a1aa",
            maxWidth: "1000px",
          }}
        >
          Multi-authority masking + reveal · intelligent network camera & integrated control server
        </div>
        <div
          style={{
            display: "flex",
            marginTop: "auto",
            color: "#52525b",
            fontSize: "24px",
          }}
        >
          mongolz.vercel.app
        </div>
      </div>
    ),
    { ...size },
  );
}
