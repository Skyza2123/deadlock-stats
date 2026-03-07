import { ImageResponse } from "next/og";

export const size = {
  width: 512,
  height: 512,
};

export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(145deg, #0b0d13 0%, #1f2937 55%, #0f172a 100%)",
          borderRadius: 96,
          border: "14px solid rgba(148, 163, 184, 0.45)",
        }}
      >
        <div
          style={{
            width: 320,
            height: 320,
            borderRadius: 72,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(160deg, #334155 0%, #0f172a 100%)",
            boxShadow: "inset 0 0 0 6px rgba(226, 232, 240, 0.18)",
            color: "#e2e8f0",
            fontSize: 138,
            fontWeight: 800,
            letterSpacing: -6,
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          }}
        >
          DS
        </div>
      </div>
    ),
    {
      ...size,
    }
  );
}
