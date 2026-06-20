import Link from "next/link";
import { GameLobby } from "@/components/game/GameLobby";

export default function HomePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <span style={{
          fontFamily: "'VT323', monospace",
          fontSize: 18,
          color: "var(--text-purple)",
          letterSpacing: 0.5,
        }}>
          OPEN GAMES
        </span>
        <Link href="/create" style={{
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 11,
          border: "3px solid var(--navy)",
          background: "var(--yellow)",
          color: "var(--navy)",
          boxShadow: "4px 4px 0 var(--navy)",
          padding: "12px 16px",
          cursor: "pointer",
          letterSpacing: 1,
          textDecoration: "none",
          display: "inline-block",
        }}>
          + HOST GAME
        </Link>
      </div>
      <GameLobby />
    </div>
  );
}
