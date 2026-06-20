"use client";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { type Address } from "@solana/kit";
import { GameState } from "@/types/game";
import { GameStatus } from "@/generated/types/gameStatus";
import { Direction } from "@/generated/types/direction";
import { PassButton } from "./PassButton";
import { PriceChart } from "@/components/price/PriceChart";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { useSession } from "@/hooks/useSession";
import { l1Connection, getErConnection } from "@/lib/connections";
import { fetchMaybePlayerAccount } from "@/generated/accounts/playerAccount";
import { findPlayerPda } from "@/generated/pdas/player";
import { getErRpc } from "@/lib/rpc";
import { calcScorePreview } from "@/lib/scores";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getVaultPDA } from "@/lib/pdas";

interface Props {
  game: GameState;
  gamePDA: PublicKey;
}

const CODENAMES = [
  "NOVA","ZEKE","GHOST","ECHO","FLUX","AXEL","VEGA","ROOK",
  "JADE","ONYX","PIKE","ROMA","KODA","LEVI","MARZ","NERO",
  "BYTE","COLT","DUKE","FINN","GALE","HAWK","IVAN","JETT",
];

function codename(wallet: string): string {
  const h = wallet.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return CODENAMES[h % CODENAMES.length];
}

function fmtTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timeRemaining(endsAt: bigint): string {
  const diff = Number(endsAt) - Math.floor(Date.now() / 1000);
  return diff <= 0 ? "00:00" : fmtTime(diff);
}

export function GameBoard({ game, gamePDA }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const price = useOraclePrice();
  const [timeLeft, setTimeLeft] = useState("");
  const [holdingFor, setHoldingFor] = useState(0);
  const [vaultCopied, setVaultCopied] = useState(false);
  const [vaultPDA] = getVaultPDA(gamePDA);
  const holderSinceRef = useRef<number>(Date.now());
  const prevHolder = useRef<string>("");
  const [holderPriceAtReceive, setHolderPriceAtReceive] = useState<number | null>(null);
  const [playerEntryPrices, setPlayerEntryPrices] = useState<Record<string, number>>({});

  const provider = publicKey && signTransaction
    ? new AnchorProvider(
        l1Connection,
        { publicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
        { commitment: "confirmed" }
      )
    : null;

  const { tempKeypairRef, sessionTokenPDARef, sessionExists, sessionLoading, isExpired, createSession, invalidateSession } =
    useSession(publicKey ?? null, provider, signTransaction as any);

  // Countdown timer
  useEffect(() => {
    const id = setInterval(() => setTimeLeft(timeRemaining(game.endsAt)), 1000);
    setTimeLeft(timeRemaining(game.endsAt));
    return () => clearInterval(id);
  }, [game.endsAt]);

  // Holding timer — reset when holder changes
  useEffect(() => {
    if (game.currentHolder !== prevHolder.current) {
      prevHolder.current = game.currentHolder as string;
      holderSinceRef.current = Date.now();
      setHoldingFor(0);
    }
    const id = setInterval(() => {
      setHoldingFor(Math.floor((Date.now() - holderSinceRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [game.currentHolder]);

  // Fetch player entry prices from ER
  useEffect(() => {
    // Reset stale price when holder changes so score doesn't flash wrong value
    setHolderPriceAtReceive(null);
    if (game.status !== GameStatus.Active) return;
    const erRpc = getErRpc();
    const gameAddress = gamePDA.toBase58() as Address;
    let cancelled = false;
    const tryFetch = async () => {
      const results = await Promise.all(
        game.players.map(async (p) => {
          try {
            const [playerPDA] = await findPlayerPda({ game: gameAddress, creator: p });
            const acc = await fetchMaybePlayerAccount(erRpc, playerPDA);
            if (!acc.exists) return null;
            return { key: p, price: Number(acc.data.priceAtReceive) };
          } catch { return null; }
        })
      );
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const r of results) if (r) map[r.key as string] = r.price;
      const holderKey = game.currentHolder as string;
      if (map[holderKey] != null) setHolderPriceAtReceive(map[holderKey]);
      setPlayerEntryPrices(map);
    };
    tryFetch();
    const id = setInterval(tryFetch, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [game.currentHolder, game.status === GameStatus.Active]);

  const direction = game.direction === Direction.Long ? "LONG" : "SHORT";
  const timerExpired = Number(game.endsAt) <= Math.floor(Date.now() / 1000);
  const isActive = game.status === GameStatus.Active && !timerExpired;
  const effectivePriceNow = price !== null
    ? Math.round(price * 1e8)
    : (Number(game.solPriceNow) > 0 ? Number(game.solPriceNow) : 0);

  const liveScoreBp = isActive && holderPriceAtReceive != null && effectivePriceNow > 0
    ? calcScorePreview(
        game.direction === Direction.Long ? "long" : "short",
        holderPriceAtReceive,
        effectivePriceNow
      )
    : null;

  const myWallet = publicKey?.toBase58();
  const myPlayerIndex = myWallet ? game.players.indexOf(myWallet as Address) : -1;
  const myRawScore = myPlayerIndex >= 0 ? Number(game.scores[myPlayerIndex] ?? BigInt(0)) : 0;
  const myIsHolder = myWallet === (game.currentHolder as string);
  const myDisplayScore = myIsHolder && liveScoreBp != null ? myRawScore + liveScoreBp : myRawScore;
  // micro-bp → % : 1% move = 10_000 micro-bp
  const myPnlPct = myDisplayScore / 10_000;

  const priceChangePct = price != null && Number(game.startPrice) > 0
    ? ((price - Number(game.startPrice) * 1e-8) / (Number(game.startPrice) * 1e-8) * 100)
    : null;

  const vaultSol = (Number(game.totalDeposited) / LAMPORTS_PER_SOL).toFixed(2);

  const statusLabel =
    game.status === GameStatus.Waiting ? "WAITING"
    : game.status === GameStatus.Active ? "ACTIVE"
    : game.status === GameStatus.Ended ? "ENDED"
    : "SETTLED";

  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

      {/* ── Left: game canvas ── */}
      <div style={{
        flex: "1 1 440px", minWidth: 300,
        border: "3px solid var(--navy)", boxShadow: "7px 7px 0 var(--navy)",
        background: "#482b61", padding: "18px 20px",
        animation: "risehud .2s ease-out both",
      }}>
        {/* Status row */}
        <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontFamily: "'Press Start 2P', monospace", fontSize: 10,
            border: "3px solid var(--navy)", background: "var(--navy)",
            color: direction === "LONG" ? "#8fe3a8" : "#ff9fb0", padding: "7px 10px",
          }}>{direction === "LONG" ? "▲" : "▼"} {direction}·SOL</span>

          <span style={{
            fontFamily: "'Press Start 2P', monospace", fontSize: 10,
            border: "3px solid var(--navy)", background: "var(--lavender)",
            color: "var(--navy)", padding: "7px 10px",
          }}>RISK {game.lossLimit}%</span>
        </div>

        {/* Price + Score row */}
        <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
          <div style={{
            flex: "1 1 50%", border: "3px solid var(--navy)", background: "var(--lavender)",
            boxShadow: "4px 4px 0 var(--navy)", padding: "13px 15px",
          }}>
            <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", letterSpacing: 1, marginBottom: 6 }}>SOL / USD</div>
            <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: "clamp(13px,1.8vw,18px)", color: "var(--navy)" }}>
              {price !== null ? `$${price.toFixed(2)}` : "—"}
            </div>
            {priceChangePct !== null && (
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: priceChangePct >= 0 ? "var(--green)" : "var(--red)", marginTop: 4 }}>
                {priceChangePct >= 0 ? "+" : ""}{priceChangePct.toFixed(2)}%
              </div>
            )}
          </div>

          <div style={{
            flex: "1 1 50%", border: "3px solid var(--navy)", background: "var(--lavender)",
            boxShadow: "4px 4px 0 var(--navy)", padding: "13px 15px",
          }}>
            <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", letterSpacing: 1, marginBottom: 6 }}>P&L</div>
            {myWallet ? (
              <div style={{
                fontFamily: "'Press Start 2P', monospace", fontSize: "clamp(13px,1.8vw,18px)",
                color: myDisplayScore > 0 ? "var(--green)" : myDisplayScore < 0 ? "var(--red)" : "var(--navy)",
              }}>
                {myPnlPct >= 0 ? "+" : ""}{myPnlPct.toFixed(2)}
                <span style={{ fontFamily: "'VT323', monospace", fontSize: 16, marginLeft: 4 }}>%</span>
              </div>
            ) : (
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)" }}>—</div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div style={{ border: "3px solid var(--navy)", background: "#f5eaf6", marginBottom: 18, padding: 6 }}>
          <PriceChart
            price={price}
            startPrice={Number(game.startPrice) > 0 ? Number(game.startPrice) * 1e-8 : null}
          />
        </div>

        {/* Session state + Pass button */}
        {isActive && (() => {
          const sessionReady = sessionExists && !isExpired;
          const needsSession = !sessionLoading && (!sessionExists || isExpired);

          if (sessionLoading) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "3px solid var(--navy)", background: "var(--lavender)" }}>
                <span style={{ width: 10, height: 10, border: "2px solid var(--navy)", borderTopColor: "transparent", display: "inline-block", animation: "spin .8s linear infinite", borderRadius: "50%" }} />
                <span style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)" }}>SYNCING SESSION…</span>
              </div>
            );
          }

          if (needsSession) {
            return (
              <div style={{ border: "3px solid var(--navy)", background: "var(--lavender)", padding: 12 }}>
                <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", marginBottom: 8 }}>
                  {isExpired ? "SESSION EXPIRED" : "NO SESSION KEY"}
                </div>
                <button onClick={createSession} style={{
                  width: "100%", fontFamily: "'Press Start 2P', monospace", fontSize: 10,
                  border: "3px solid var(--navy)", background: "var(--navy)", color: "var(--yellow)",
                  boxShadow: "4px 4px 0 var(--navy)", padding: 12, cursor: "pointer",
                }}>
                  {isExpired ? "RENEW SESSION" : "CREATE SESSION KEY"}
                </button>
              </div>
            );
          }

          return (
            <PassButton
              game={game}
              gamePDA={gamePDA}
              tempKeypair={sessionReady ? tempKeypairRef.current : null}
              sessionTokenPDA={sessionReady ? sessionTokenPDARef.current : null}
              onNeedSession={invalidateSession}
            />
          );
        })()}
      </div>

      {/* ── Right: roster ── */}
      <div style={{ flex: "0 0 240px", display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Header */}
        <div style={{
          fontFamily: "'Press Start 2P', monospace", fontSize: 10,
          border: "3px solid var(--navy)", background: "var(--navy)",
          color: "var(--text-bright)", boxShadow: "4px 4px 0 var(--navy)",
          padding: "11px 14px", letterSpacing: 1,
        }}>
          PLAYERS · {game.playerCount}/{game.maxPlayers}
        </div>

        {/* Player cards — scrollable for large lobbies */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, maxHeight: 420, overflowY: "auto" }}>
        {game.players.map((wallet, i) => {
          const isHolder = wallet === game.currentHolder;
          const isMe = myWallet && wallet === myWallet;
          const rawScore = Number(game.scores[i] ?? BigInt(0));
          const displayScore = isHolder && liveScoreBp != null ? rawScore + liveScoreBp : rawScore;
          const scorePct = displayScore / 10_000;
          const scoreColor = displayScore > 0 ? "var(--green)" : displayScore < 0 ? "var(--red)" : "var(--navy)";
          const name = isMe ? "YOU" : codename(wallet as string);
          const addr = `${(wallet as string).slice(0, 4)}…${(wallet as string).slice(-4)}`;

          return (
            <div key={wallet as string} style={{
              border: "3px solid var(--navy)",
              boxShadow: isHolder
                ? "3px 3px 0 var(--navy), 0 0 10px rgba(255,206,58,.35)"
                : "3px 3px 0 var(--navy)",
              background: isHolder ? "var(--yellow)" : "var(--lavender)",
              padding: "7px 10px",
              animation: isHolder ? "holdglow 1.6s steps(2) infinite" : undefined,
            }}>
              {/* Top row: rank + name + score */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {/* Rank badge */}
                <span style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: 8,
                  border: "2px solid var(--navy)",
                  background: isHolder ? "var(--navy)" : "var(--lavender)",
                  color: isHolder ? "var(--yellow)" : "var(--navy)",
                  padding: "3px 4px", flexShrink: 0, lineHeight: 1,
                }}>
                  {isHolder ? "★" : "#"}{i + 1}
                </span>

                {/* Name + wallet */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: "'Press Start 2P', monospace", fontSize: 8,
                    color: "var(--navy)", letterSpacing: 0.5,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{name}</div>
                  <div style={{
                    fontFamily: "'VT323', monospace", fontSize: 12,
                    color: isHolder ? "rgba(0,0,0,.5)" : "var(--text-muted)",
                    letterSpacing: 0.5, marginTop: 1,
                  }}>{addr}</div>
                </div>

                {/* Score */}
                <div style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: 9,
                  color: isHolder ? (displayScore >= 0 ? "#1a7c3a" : "#b02020") : scoreColor,
                  flexShrink: 0,
                }}>
                  {scorePct >= 0 ? "+" : ""}{scorePct.toFixed(2)}%
                </div>
              </div>

              {/* Holder row: HOLDING + elapsed */}
              {isHolder && (
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  marginTop: 5,
                }}>
                  <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: "var(--navy)", letterSpacing: 1 }}>HOLDING</span>
                  <span style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--navy)" }}>{fmtTime(holdingFor)}</span>
                </div>
              )}
            </div>
          );
        })}
        </div>

        {/* Vault */}
        <div style={{
          border: "3px solid var(--navy)", boxShadow: "4px 4px 0 var(--navy)",
          background: "var(--lavender)", padding: "10px 14px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <button
            onClick={() => {
              navigator.clipboard.writeText(vaultPDA.toBase58());
              setVaultCopied(true);
              setTimeout(() => setVaultCopied(false), 1500);
            }}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6 }}
          >
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: "var(--text-muted)", letterSpacing: 1 }}>VAULT</span>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: 13, color: "var(--text-muted)" }}>{vaultCopied ? "✓ COPIED" : "⧉"}</span>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: 18, color: "var(--navy)" }}>◎</span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: "var(--navy)" }}>{vaultSol}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
