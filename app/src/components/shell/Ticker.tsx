"use client";

const TEXT = "FLOW · TRADING ARENA · REAL-TIME · SETTLED ON L1 · EPHEMERAL ROLLUP · PASS THE POSITION · ";

export function Ticker() {
  return (
    <div style={{
      background: "var(--navy)",
      borderTop: "4px solid var(--navy)",
      overflow: "hidden",
      padding: "7px 0",
      whiteSpace: "nowrap",
    }}>
      <div style={{ display: "inline-flex", animation: "marquee 20s linear infinite" }}>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "#7fe6a0", letterSpacing: 1, paddingRight: 40 }}>{TEXT}</span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "#7fe6a0", letterSpacing: 1, paddingRight: 40 }}>{TEXT}</span>
      </div>
    </div>
  );
}
