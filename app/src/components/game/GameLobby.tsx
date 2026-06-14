"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { l1Connection } from "@/lib/connections";
import { getProgram, PROGRAM_ID } from "@/lib/anchor";
import { GameState } from "@/types/game";

interface GameEntry {
  pubkey: PublicKey;
  account: GameState;
}

// Singleton — Program constructor is expensive in Anchor 0.32 (builds all type
// codecs from the full IDL synchronously). Creating it on every poll blocks the
// main thread long enough to trigger "Page Unresponsive".
let _program: ReturnType<typeof getProgram> | null = null;
function getLobbyProgram() {
  if (!_program) {
    const provider = new AnchorProvider(l1Connection, {} as any, {
      commitment: "confirmed",
    });
    _program = getProgram(provider);
  }
  return _program;
}

// 8s gives Helius devnet enough time without making the user wait too long.
const FETCH_TIMEOUT_MS = 8_000;
// Poll every 15s — frequent enough to surface new games, cheap on RPC credits.
const POLL_INTERVAL_MS = 15_000;

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      intervalMs
    );
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

export function GameLobby() {
  const [games, setGames] = useState<GameEntry[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"open" | "history">("open");
  const now = useNow(1_000);
  const hasData = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    async function fetchGames() {
      if (inFlight) return;
      inFlight = true;
      if (!hasData.current) {
        // First load — show spinner instead of stale list
        setInitialLoading(true);
      } else {
        // Subsequent polls — show subtle indicator, keep current list visible
        setRefreshing(true);
      }

      try {
        const program = getLobbyProgram();

        // Promise.race with a hard timeout so a hanging getProgramAccounts call
        // shows an error in 8s instead of freezing the page indefinitely.
        // Note: the underlying HTTP request is not cancelled (web3.js doesn't
        // expose an AbortSignal here), but it will eventually timeout on its own.
        const rawAccounts = await Promise.race([
          l1Connection.getProgramAccounts(PROGRAM_ID, {
            filters: [{ dataSize: 487 }],
          }),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("RPC timed out — check your connection")),
              FETCH_TIMEOUT_MS
            )
          ),
        ]);

        const all = rawAccounts.map((acc) => ({
          publicKey: acc.pubkey,
          account: (program.coder.accounts as any).decode(
            "gameState",
            acc.account.data
          ),
        }));

        if (cancelled) return;

        const visible = all.filter(
          (g: any) =>
            "waiting" in g.account.status ||
            "active" in g.account.status ||
            "ended" in g.account.status ||
            "settled" in g.account.status
        );
        setGames(
          visible.map((g: any) => ({
            pubkey: g.publicKey,
            account: g.account as GameState,
          }))
        );
        setError(null);
        hasData.current = true;
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load games");
      } finally {
        inFlight = false;
        if (!cancelled) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchGames();
    const id = setInterval(fetchGames, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  const [copiedPDA, setCopiedPDA] = useState<string | null>(null);
  const copyPDA = useCallback((e: React.MouseEvent, addr: string) => {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(addr).then(() => {
      setCopiedPDA(addr);
      setTimeout(() => setCopiedPDA(null), 1500);
    });
  }, []);

  // ── First load spinner ──────────────────────────────────────────────────────
  if (initialLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <span className="animate-spin inline-block w-3 h-3 border border-gray-600 border-t-gray-300 rounded-full" />
        Loading games…
      </div>
    );
  }

  // Derive filtered sets — search matches against full PDA string (case-insensitive)
  const searchLower = search.trim().toLowerCase();
  const allOpen = games.filter(
    ({ account }) => "waiting" in account.status || "active" in account.status
  );
  const allPast = games.filter(
    ({ account }) => "ended" in account.status || "settled" in account.status
  );

  // When searching: ignore active tab and show matching results from both groups.
  // When not searching: respect the active tab.
  const matchesPDA = (pubkey: PublicKey) =>
    !searchLower || pubkey.toBase58().toLowerCase().includes(searchLower);

  const openGames = allOpen.filter(({ pubkey }) => matchesPDA(pubkey));
  const pastGames = allPast.filter(({ pubkey }) => matchesPDA(pubkey));

  // Auto-switch tab hint when search has results only in the other tab
  const searchHasOpenOnly =
    searchLower && openGames.length > 0 && pastGames.length === 0;
  const searchHasPastOnly =
    searchLower && pastGames.length > 0 && openGames.length === 0;

  const showOpen = searchLower ? openGames.length > 0 : activeTab === "open";
  const showHistory = searchLower
    ? pastGames.length > 0
    : activeTab === "history";

  function GameCard({
    pubkey,
    account,
    variant,
  }: {
    pubkey: PublicKey;
    account: GameState;
    variant: "open" | "history";
  }) {
    const dir = "long" in account.direction ? "LONG" : "SHORT";
    const dirColor = dir === "LONG" ? "text-green-400" : "text-red-400";
    const feeSol = account.entryFee.toNumber() / LAMPORTS_PER_SOL;
    const creatorShort = `${account.creator
      .toBase58()
      .slice(0, 4)}…${account.creator.toBase58().slice(-4)}`;
    const pdaFull = pubkey.toBase58();
    const pdaShort = `${pdaFull.slice(0, 8)}…${pdaFull.slice(-8)}`;
    const isCopied = copiedPDA === pdaFull;

    if (variant === "open") {
      const isWaiting = "waiting" in account.status;
      const canJoin = isWaiting && account.playerCount < account.maxPlayers;
      const statusLabel = isWaiting ? "WAITING" : "ACTIVE";
      const statusColor = isWaiting ? "text-yellow-400" : "text-green-400";
      const countdown = timeRemaining(account.endsAt.toNumber(), now);
      const expired = countdown === "Expired";
      return (
        <Link href={`/game/${pdaFull}`}>
          <div
            className={`border rounded p-4 transition-colors cursor-pointer bg-gray-950 ${
              expired
                ? "border-gray-900 opacity-50"
                : "border-gray-800 hover:border-gray-600"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${statusColor}`}>
                  {statusLabel}
                </span>
                <span className={`text-sm font-bold ${dirColor}`}>{dir}</span>
                {canJoin && (
                  <span className="text-xs bg-blue-900 text-blue-300 px-2 py-0.5 rounded font-bold">
                    JOIN
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-mono ${
                  expired ? "text-gray-700" : "text-gray-500"
                }`}
              >
                {countdown}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-300 font-mono">
                {feeSol} SOL entry
              </span>
              <span
                className={`text-gray-400 ${canJoin ? "text-blue-400" : ""}`}
              >
                {account.playerCount}/{account.maxPlayers} players
                {canJoin &&
                  ` — ${account.maxPlayers - account.playerCount} slot${
                    account.maxPlayers - account.playerCount > 1 ? "s" : ""
                  } open`}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-600 font-mono">
                creator: {creatorShort}
              </span>
              <button
                onClick={(e) => copyPDA(e, pdaFull)}
                className="flex items-center gap-1 text-xs font-mono text-gray-700 hover:text-gray-400 transition-colors"
                title="Copy game PDA"
              >
                {isCopied ? (
                  <span className="text-green-500">✓ copied</span>
                ) : (
                  <>
                    <span>{pdaShort}</span>
                    <span className="ml-1 opacity-60">⎘</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </Link>
      );
    }

    // history variant
    const isSettled = "settled" in account.status;
    const statusLabel = isSettled ? "SETTLED" : "ENDED";
    const statusColor = isSettled ? "text-gray-400" : "text-red-400";
    const finalPriceSol =
      account.finalPrice.toNumber() > 0
        ? `$${(account.finalPrice.toNumber() * 1e-8).toFixed(2)}`
        : null;
    return (
      <Link href={`/game/${pdaFull}`}>
        <div className="border border-gray-900 rounded p-4 transition-colors cursor-pointer bg-gray-950 hover:border-gray-700 opacity-75 hover:opacity-100">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold ${statusColor}`}>
                {statusLabel}
              </span>
              <span className={`text-sm font-bold ${dirColor}`}>{dir}</span>
            </div>
            {finalPriceSol && (
              <span className="text-xs font-mono text-gray-500">
                final {finalPriceSol}
              </span>
            )}
          </div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-500 font-mono">{feeSol} SOL entry</span>
            <span className="text-gray-600">{account.playerCount} players</span>
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-gray-700 font-mono">
              creator: {creatorShort}
            </span>
            <button
              onClick={(e) => copyPDA(e, pdaFull)}
              className="flex items-center gap-1 text-xs font-mono text-gray-700 hover:text-gray-400 transition-colors"
              title="Copy game PDA"
            >
              {isCopied ? (
                <span className="text-green-500">✓ copied</span>
              ) : (
                <>
                  <span>{pdaShort}</span>
                  <span className="ml-1 opacity-60">⎘</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Link>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by game address (PDA)…"
          className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-700 font-mono focus:outline-none focus:border-gray-600"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-400 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      {/* Tabs — hidden when search is active (search shows all matching regardless of tab) */}
      {!searchLower && (
        <div className="flex gap-0 border border-gray-800 rounded overflow-hidden">
          <button
            onClick={() => setActiveTab("open")}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${
              activeTab === "open"
                ? "bg-gray-800 text-white"
                : "bg-gray-950 text-gray-600 hover:text-gray-400"
            }`}
          >
            Open {allOpen.length > 0 && `(${allOpen.length})`}
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors border-l border-gray-800 ${
              activeTab === "history"
                ? "bg-gray-800 text-white"
                : "bg-gray-950 text-gray-600 hover:text-gray-400"
            }`}
          >
            History {allPast.length > 0 && `(${allPast.length})`}
          </button>
        </div>
      )}

      {/* Status bar */}
      {(refreshing || error) && (
        <div className="flex items-center justify-between text-xs py-1">
          {refreshing && !error && (
            <span className="text-gray-600 flex items-center gap-1">
              <span className="animate-spin inline-block w-2 h-2 border border-gray-700 border-t-gray-400 rounded-full" />
              refreshing…
            </span>
          )}
          {error && <span className="text-red-500">{error}</span>}
          {error && (
            <button
              onClick={() => {
                setError(null);
                hasData.current = false;
                setInitialLoading(true);
                setRetryKey((k) => k + 1);
              }}
              className="text-gray-400 underline hover:text-gray-200 ml-2"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Search: no results at all */}
      {searchLower && openGames.length === 0 && pastGames.length === 0 && (
        <div className="text-gray-600 text-sm py-4 text-center">
          No games found for that address.
        </div>
      )}

      {/* No games at all (not a search result, just empty) */}
      {!searchLower && games.length === 0 && !error && (
        <div className="text-gray-500 text-sm py-4">
          No games yet.{" "}
          <Link href="/create" className="text-green-400 hover:underline">
            Create one!
          </Link>
        </div>
      )}

      {/* Open games */}
      {showOpen && (
        <div className="space-y-2">
          {searchLower && searchHasOpenOnly && (
            <div className="text-xs text-gray-600 uppercase tracking-wider">
              Open
            </div>
          )}
          {openGames.length === 0 && !searchLower && (
            <div className="text-gray-600 text-sm py-4 text-center">
              No open games.{" "}
              <Link href="/create" className="text-green-400 hover:underline">
                Create one!
              </Link>
            </div>
          )}
          {openGames.map(({ pubkey, account }) => (
            <GameCard
              key={pubkey.toBase58()}
              pubkey={pubkey}
              account={account}
              variant="open"
            />
          ))}
        </div>
      )}

      {/* History games */}
      {showHistory && (
        <div className="space-y-2">
          {searchLower && pastGames.length > 0 && openGames.length > 0 && (
            <div className="text-xs text-gray-600 uppercase tracking-wider mt-2">
              History
            </div>
          )}
          {pastGames.length === 0 && !searchLower && (
            <div className="text-gray-600 text-sm py-4 text-center">
              No past games yet.
            </div>
          )}
          {pastGames.map(({ pubkey, account }) => (
            <GameCard
              key={pubkey.toBase58()}
              pubkey={pubkey}
              account={account}
              variant="history"
            />
          ))}
        </div>
      )}
    </div>
  );
}
