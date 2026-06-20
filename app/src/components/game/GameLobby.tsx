"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { type Address } from "@solana/kit";
import { l1Connection, getErConnection } from "@/lib/connections";
import { FLOW_PROGRAM_ADDRESS } from "@/generated/programs/flow";

const PROGRAM_ID = new PublicKey(FLOW_PROGRAM_ADDRESS);
import { decodeGameState } from "@/generated/accounts/gameState";
import { GameState } from "@/types/game";
import { GameStatus } from "@/generated/types/gameStatus";
import { Direction } from "@/generated/types/direction";

interface GameEntry {
  pubkey: PublicKey;
  account: GameState;
}

function decodeRaw(raw: { pubkey: PublicKey; account: { data: Buffer } }): { publicKey: PublicKey; account: GameState } | null {
  try {
    const encoded = { address: raw.pubkey.toBase58() as Address, data: raw.account.data as unknown as Uint8Array };
    const decoded = decodeGameState(encoded as any);
    return { publicKey: raw.pubkey, account: decoded.data };
  } catch { return null; }
}

const FETCH_TIMEOUT_MS = 4_000;
const POLL_INTERVAL_MS = 15_000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function timeRemaining(endsAt: number, now: number): string {
  const diff = endsAt - now;
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}m ${s < 10 ? "0" : ""}${s}s`;
}

const cardStyle: React.CSSProperties = {
  position: "relative",
  border: "3px solid var(--navy)",
  boxShadow: "5px 5px 0 var(--navy)",
  background: "var(--lavender)",
  padding: "16px 17px",
};

const dirBadge = (dir: "LONG" | "SHORT"): React.CSSProperties => ({
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 10,
  border: "3px solid var(--navy)",
  padding: "6px 8px",
  background: "var(--navy)",
  color: dir === "LONG" ? "#8fe3a8" : "#ff9fb0",
  display: "inline-block",
});

export function GameLobby() {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"open" | "history">("open");
  const now = useNow(1_000);
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    async function fetchGames() {
      if (inFlight) return;
      inFlight = true;
      if (!hasData.current) setInitialLoading(true);
      else setRefreshing(true);
      try {
        const erConn = getErConnection();
        const [l1Raw, erRaw] = await Promise.race([
          Promise.all([
            l1Connection.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: 487 }] }),
            erConn.getProgramAccounts(PROGRAM_ID, { filters: [{ dataSize: 487 }] }).catch(() => [] as any[]),
          ]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("RPC timed out — check your connection")), FETCH_TIMEOUT_MS)
          ),
        ]);
        const decode = (raw: readonly any[]) =>
          raw.flatMap((acc) => { const r = decodeRaw(acc); return r ? [r] : []; });
        const merged = new Map<string, { publicKey: PublicKey; account: GameState }>();
        for (const g of decode(l1Raw)) merged.set(g.publicKey.toBase58(), g);
        for (const g of decode(erRaw)) {
          if (g.account.status === GameStatus.Active || g.account.status === GameStatus.Ended)
            merged.set(g.publicKey.toBase58(), g);
        }
        if (cancelled) return;
        setGames(Array.from(merged.values()).map((g) => ({ pubkey: g.publicKey, account: g.account })));
        setError(null);
        hasData.current = true;
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load games");
      } finally {
        inFlight = false;
        if (!cancelled) { setInitialLoading(false); setRefreshing(false); }
      }
    }
    fetchGames();
    const id = setInterval(fetchGames, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [retryKey]);

  const [copiedPDA, setCopiedPDA] = useState<string | null>(null);
  const copyPDA = useCallback((e: React.MouseEvent, addr: string) => {
    e.preventDefault(); e.stopPropagation();
    navigator.clipboard.writeText(addr).then(() => {
      setCopiedPDA(addr); setTimeout(() => setCopiedPDA(null), 1500);
    });
  }, []);

  if (initialLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "40px 0" }}>
        <span style={{ display: "flex", gap: 5 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ width: 12, height: 12, background: "var(--text-purple)", display: "inline-block", animation: `blink 1s steps(1) infinite ${i * 0.33}s` }} />
          ))}
        </span>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: "var(--navy)" }}>LOADING</span>
        <span style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)" }}>connecting to rollup…</span>
      </div>
    );
  }

  const allOpen = games.filter(({ account }) => account.status === GameStatus.Waiting || account.status === GameStatus.Active);
  const allPast = games.filter(({ account }) => account.status === GameStatus.Ended || account.status === GameStatus.Settled);
  const showOpen = activeTab === "open";
  const showHistory = activeTab === "history";

  function GameCard({ pubkey, account, variant }: { pubkey: PublicKey; account: GameState; variant: "open" | "history" }) {
    const dir = account.direction === Direction.Long ? "LONG" : "SHORT";
    const feeSol = Number(account.entryFee) / LAMPORTS_PER_SOL;
    const pdaFull = pubkey.toBase58();
    const pdaShort = `${pdaFull.slice(0, 8)}…${pdaFull.slice(-8)}`;
    const isCopied = copiedPDA === pdaFull;

    if (variant === "open") {
      const isWaiting = account.status === GameStatus.Waiting;
      const countdown = timeRemaining(Number(account.endsAt), now);
      const expired = countdown === "Expired";
      const canJoin = isWaiting && !expired && account.playerCount < account.maxPlayers;
      const statusLabel = expired ? "EXPIRED" : isWaiting ? "WAITING" : "ACTIVE";
      const statusColor = expired ? "var(--text-muted)" : isWaiting ? "var(--yellow)" : "var(--green)";
      return (
        <Link href={`/game/${pdaFull}`} style={{ textDecoration: "none" }}>
          <div style={{ ...cardStyle, opacity: expired ? 0.7 : 1 }}>
            {expired && (
              <div style={{
                position: "absolute", inset: 0, zIndex: 10,
                display: "flex", alignItems: "center", justifyContent: "center",
                pointerEvents: "none",
              }}>
                <div style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: 18,
                  color: "#fff", background: "#e8334a",
                  border: "3px solid #0a0e23", padding: "8px 18px",
                  transform: "rotate(-12deg)",
                  boxShadow: "3px 3px 0 #0a0e23",
                  letterSpacing: 2,
                  userSelect: "none",
                }}>
                  EXPIRED
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 12 }}>
              <span style={{ ...dirBadge(dir as "LONG" | "SHORT") }}>{dir === "LONG" ? "▲" : "▼"} {dir}</span>
              <span style={{ fontFamily: "'VT323', monospace", fontSize: 17, color: "var(--text-muted)", letterSpacing: 0.5 }}>⏱ {countdown}</span>
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 14 }}>
              <div>
                <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", letterSpacing: 0.5 }}>STATUS</div>
                <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, marginTop: 5, color: statusColor }}>{statusLabel}</div>
              </div>
              <div>
                <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", letterSpacing: 0.5 }}>ENTRY</div>
                <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, marginTop: 5, color: "var(--navy)" }}>{feeSol} ◎</div>
              </div>
              <div>
                <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", letterSpacing: 0.5 }}>PLAYERS</div>
                <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, marginTop: 5, color: "var(--navy)" }}>{account.playerCount}/{account.maxPlayers}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <button
                style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: 10,
                  border: "3px solid var(--navy)",
                  background: canJoin ? "var(--navy)" : "var(--lavender)",
                  color: canJoin ? "var(--yellow)" : "var(--text-muted)",
                  boxShadow: "4px 4px 0 var(--navy)", padding: "10px 14px", cursor: canJoin ? "pointer" : "default", letterSpacing: 1,
                }}
              >
                {canJoin ? "JOIN ▶" : isWaiting ? "WAITING" : "VIEW ▶"}
              </button>
              <button
                onClick={(e) => copyPDA(e, pdaFull)}
                style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}
              >
                {isCopied ? "✓ copied" : pdaShort + " ⎘"}
              </button>
            </div>
          </div>
        </Link>
      );
    }

    const isSettled = account.status === GameStatus.Settled;
    const statusLabel = isSettled ? "SETTLED" : "ENDED";
    const stampColor = isSettled ? "#4caf82" : "#e8334a";
    const finalPriceSol = Number(account.finalPrice) > 0 ? `$${(Number(account.finalPrice) * 1e-8).toFixed(2)}` : null;
    return (
      <Link href={`/game/${pdaFull}`} style={{ textDecoration: "none" }}>
        <div style={{ ...cardStyle, opacity: 0.85 }}>
          <div style={{
            position: "absolute", inset: 0, zIndex: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
          }}>
            <div style={{
              fontFamily: "'Press Start 2P', monospace", fontSize: 16,
              color: "#fff", background: stampColor,
              border: "3px solid #0a0e23", padding: "8px 18px",
              transform: "rotate(-12deg)",
              boxShadow: "3px 3px 0 #0a0e23",
              letterSpacing: 2, userSelect: "none",
            }}>
              {statusLabel}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span style={{ ...dirBadge(dir as "LONG" | "SHORT") }}>{dir === "LONG" ? "▲" : "▼"} {dir}</span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, color: isSettled ? "var(--text-muted)" : "var(--red)" }}>{statusLabel}</span>
              {finalPriceSol && <span style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)" }}>final {finalPriceSol}</span>}
            </div>
          </div>
          <div style={{ display: "flex", gap: 16, marginBottom: 10 }}>
            <div>
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)" }}>ENTRY</div>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, marginTop: 5, color: "var(--navy)" }}>{feeSol} ◎</div>
            </div>
            <div>
              <div style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)" }}>PLAYERS</div>
              <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 10, marginTop: 5, color: "var(--navy)" }}>{account.playerCount}</div>
            </div>
          </div>
          <button onClick={(e) => copyPDA(e, pdaFull)} style={{ fontFamily: "'VT323', monospace", fontSize: 14, color: "var(--text-muted)", background: "transparent", border: "none", cursor: "pointer" }}>
            {isCopied ? "✓ copied" : pdaShort + " ⎘"}
          </button>
        </div>
      </Link>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Tabs */}
      <div style={{ display: "flex", border: "3px solid var(--navy)", boxShadow: "4px 4px 0 var(--navy)", background: "var(--lavender)", overflow: "hidden" }}>
        {(["open", "history"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            flex: 1, padding: "12px 15px",
            fontFamily: "'Press Start 2P', monospace", fontSize: 10,
            border: "none", borderRight: tab === "open" ? "3px solid var(--navy)" : "none",
            background: activeTab === tab ? "var(--navy)" : "transparent",
            color: activeTab === tab ? "var(--yellow)" : "var(--navy)",
            cursor: "pointer", letterSpacing: 0.5,
          }}>
            {tab === "open" ? `OPEN GAMES${allOpen.length > 0 ? ` (${allOpen.length})` : ""}` : `HISTORY${allPast.length > 0 ? ` (${allPast.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Status */}
      {(refreshing || error) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "'VT323', monospace", fontSize: 15 }}>
          {refreshing && !error && <span style={{ color: "var(--text-muted)" }}>refreshing…</span>}
          {error && <span style={{ color: "var(--red)" }}>{error}</span>}
          {error && (
            <button onClick={() => { setError(null); hasData.current = false; setInitialLoading(true); setRetryKey((k) => k + 1); }}
              style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, background: "transparent", border: "none", color: "var(--navy)", cursor: "pointer", textDecoration: "underline" }}>
              ↻ RETRY
            </button>
          )}
        </div>
      )}

      {/* Open games */}
      {showOpen && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
          {allOpen.length === 0 && !error && (
            <div style={{ gridColumn: "1/-1", fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "40px 0" }}>
              NO OPEN GAMES<br />
              <Link href="/create" style={{ color: "var(--yellow)", textDecoration: "none", fontSize: 9, display: "block", marginTop: 16 }}>+ HOST ONE ▶</Link>
            </div>
          )}
          {allOpen.map(({ pubkey, account }) => (
            <GameCard key={pubkey.toBase58()} pubkey={pubkey} account={account} variant="open" />
          ))}
        </div>
      )}

      {/* History */}
      {showHistory && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 16 }}>
          {allPast.length === 0 && (
            <div style={{ gridColumn: "1/-1", fontFamily: "'Press Start 2P', monospace", fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "40px 0" }}>
              NO PAST GAMES YET
            </div>
          )}
          {allPast.map(({ pubkey, account }) => (
            <GameCard key={pubkey.toBase58()} pubkey={pubkey} account={account} variant="history" />
          ))}
        </div>
      )}
    </div>
  );
}
