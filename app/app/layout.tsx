import type { Metadata } from "next";
import "./globals.css";
import { WalletContextProvider } from "@/components/wallet/WalletProvider";
import { StarField } from "@/components/shell/StarField";
import { NavBar } from "@/components/shell/NavBar";
import { TxToastProvider } from "@/components/shell/TxToast";

export const metadata: Metadata = {
  title: "FLOW — Hot Potato Trading Arena",
  description: "Pass the live SOL position before it reverses. Earn yield from real price movement.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323:wght@400&display=swap" rel="stylesheet" />
      </head>
      <body style={{
        margin: 0,
        minHeight: "100vh",
        background: "linear-gradient(#070b1d 0%, #101737 52%, #1b2450 100%)",
        fontFamily: "'VT323', monospace",
        color: "var(--navy)",
      }}>
        <TxToastProvider>
        <WalletContextProvider>
          {/* Stars */}
          <StarField />

          {/* Scanlines */}
          <div style={{
            position: "fixed", inset: 0, pointerEvents: "none", zIndex: 95,
            background: "repeating-linear-gradient(#000 0 1px, transparent 1px 3px)",
            opacity: 0.08,
            animation: "scan 1.2s steps(3) infinite",
          }} />
          {/* Vignette */}
          <div style={{
            position: "fixed", inset: 0, pointerEvents: "none", zIndex: 94,
            background: "radial-gradient(120% 90% at 50% 38%, transparent 55%, rgba(4,7,18,.6) 100%)",
          }} />

          {/* Content column */}
          <div style={{ position: "relative", zIndex: 2, maxWidth: 1200, margin: "0 auto", padding: "clamp(16px,3vw,30px) clamp(14px,3vw,30px) 40px" }}>

            {/* Hero logo */}
            <div style={{ textAlign: "center", marginBottom: "clamp(14px,2.4vw,22px)", animation: "bob 4s ease-in-out infinite" }}>
              <div style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: "clamp(28px,5.5vw,54px)",
                letterSpacing: 3,
                lineHeight: 1,
                color: "var(--yellow)",
                textShadow: "1px -1px 0 #fff3c0,-3px 0 0 var(--navy),3px 0 0 var(--navy),0 -3px 0 var(--navy),0 3px 0 var(--navy),-3px -3px 0 var(--navy),3px -3px 0 var(--navy),-3px 3px 0 var(--navy),3px 3px 0 var(--navy),5px 5px 0 var(--navy),7px 7px 0 var(--navy),9px 9px 0 #2c1a0a",
              }}>FLOW</div>
              <div style={{
                fontFamily: "'VT323', monospace",
                fontSize: "clamp(14px,2vw,19px)",
                letterSpacing: 3,
                color: "var(--text-blue)",
                marginTop: 12,
                textShadow: "2px 2px 0 var(--navy)",
              }}>▸ FLOW TRADING ARENA ◂</div>
            </div>

            {/* Window shell */}
            <div style={{ border: "4px solid var(--navy)", boxShadow: "9px 9px 0 var(--navy)", background: "var(--win-bg)" }}>

              {/* Nav bar + wallet */}
              <NavBar />

              {/* Window body with grid */}
              <div style={{
                position: "relative",
                background: "var(--win-bg)",
                backgroundImage: "linear-gradient(var(--win-grid) 1px, transparent 1px), linear-gradient(90deg, var(--win-grid) 1px, transparent 1px)",
                backgroundSize: "26px 26px",
                padding: "clamp(16px,2.6vw,26px)",
                minHeight: 400,
              }}>
                {children}
              </div>

            </div>

            {/* Footer */}
            <div style={{ textAlign: "center", marginTop: 18 }}>
              <a
                href="https://magicblock.gg"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: "'VT323', monospace",
                  fontSize: 15,
                  letterSpacing: 2,
                  color: "var(--text-muted)",
                  textDecoration: "none",
                  opacity: 0.7,
                }}
              >
                ⚡ BUILT WITH MAGICBLOCK
              </a>
            </div>

          </div>
        </WalletContextProvider>
        </TxToastProvider>
      </body>
    </html>
  );
}
