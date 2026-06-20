"use client";
import { type Address } from "@solana/kit";
import { GameState } from "@/types/game";
import { bpToPercent, scoreColor } from "@/lib/scores";

interface Props {
  game: GameState;
  currentWallet?: Address | null;
  liveScoreBp?: number | null;
  holderWallet?: Address | null;
  playerEntryPrices?: Record<string, number>;
}

export function ScoreDisplay({ game, currentWallet, liveScoreBp, holderWallet, playerEntryPrices }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", letterSpacing: 1, marginBottom: 2 }}>YOUR SCORE</div>
      {game.players.map((player, i) => {
        const key = player;
        const score = Number(game.scores[i] ?? BigInt(0));
        const isHolder = holderWallet ? key === holderWallet : key === game.currentHolder;
        const isMe = currentWallet && key === currentWallet;
        const showLive = isHolder && liveScoreBp !== null && liveScoreBp !== undefined;
        const displayScore = showLive ? score + liveScoreBp! : score;
        const entryPrice = playerEntryPrices?.[key];
        const entryUsd = entryPrice != null && entryPrice > 0 ? `$${(entryPrice * 1e-8).toFixed(4)}` : null;
        const sc = scoreColor(displayScore);
        const color = sc.includes("green") ? "var(--green)" : sc.includes("red") ? "var(--red)" : "var(--text-muted)";

        return (
          <div key={key} style={{
            border: "3px solid var(--navy)",
            boxShadow: isHolder ? "4px 4px 0 var(--navy),0 0 10px rgba(255,206,58,.3)" : "4px 4px 0 var(--navy)",
            background: isHolder ? "rgba(255,206,58,.08)" : "var(--lavender)",
            padding: "10px 12px",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--navy)" }}>
                  {key.slice(0, 4)}…{key.slice(-4)}
                </span>
                {isMe && <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: "var(--text-blue)", border: "1px solid var(--text-blue)", padding: "2px 4px" }}>YOU</span>}
                {isHolder && <span style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--yellow)", animation: "coinspin 2.4s steps(6) infinite" }}>★</span>}
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color }}>
                  {displayScore >= 0 ? "+" : ""}{bpToPercent(displayScore)}
                </span>
                {showLive && <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--yellow)" }}>LIVE</div>}
              </div>
            </div>
            {entryUsd && (
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", marginTop: 4 }}>
                entry <span style={{ color: "var(--navy)" }}>{entryUsd}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
