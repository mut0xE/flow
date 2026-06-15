"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { GameState } from "@/types/game";
import { ScoreDisplay } from "./ScoreDisplay";
import { PassButton } from "./PassButton";
import { PriceChart } from "@/components/price/PriceChart";
import { useOraclePrice } from "@/hooks/useOraclePrice";
import { useSession } from "@/hooks/useSession";
import { l1Connection, getErConnection } from "@/lib/connections";
import { getProgram } from "@/lib/anchor";
import { getPlayerPDA } from "@/lib/pdas";
import { calcScorePreview } from "@/lib/scores";

interface Props {
  game: GameState;
  gamePDA: PublicKey;
}

function statusLabel(status: GameState["status"]): { label: string; color: string } {
  if ("waiting" in status) return { label: "WAITING", color: "text-yellow-400" };
  if ("active" in status) return { label: "ACTIVE", color: "text-green-400" };
  if ("ended" in status) return { label: "ENDED", color: "text-red-400" };
  return { label: "SETTLED", color: "text-gray-400" };
}

function timeRemaining(endsAt: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endsAt - now;
  if (diff <= 0) return "Ended";
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}m ${s}s`;
}

export function GameBoard({ game, gamePDA }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const price = useOraclePrice();
  const [timeLeft, setTimeLeft] = useState("");
  const [holderPriceAtReceive, setHolderPriceAtReceive] = useState<number | null>(null);
  const [playerEntryPrices, setPlayerEntryPrices] = useState<Record<string, number>>({});

  const provider =
    publicKey && signTransaction
      ? new AnchorProvider(
          l1Connection,
          { publicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
          { commitment: "confirmed" }
        )
      : null;

  const { tempKeypairRef, sessionTokenPDARef, sessionExists, isExpired, createSession } =
    useSession(publicKey ?? null, provider, signTransaction as any);

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(timeRemaining(game.endsAt.toNumber())), 1000);
    setTimeLeft(timeRemaining(game.endsAt.toNumber()));
    return () => clearInterval(id);
  }, [game.endsAt]);

  // Fetch all players' price_at_receive from ER PlayerAccounts every 2s
  useEffect(() => {
    if (!("active" in game.status)) return;
    const erConn = getErConnection();
    const erProgram = getProgram(
      new AnchorProvider(erConn, {} as any, { commitment: "confirmed" })
    );
    let cancelled = false;
    const tryFetch = () => {
      Promise.all(
        game.players.map((p) =>
          (erProgram.account as any).playerAccount
            .fetch(getPlayerPDA(gamePDA, p)[0])
            .then((acc: any) => ({ key: p.toBase58(), price: acc.priceAtReceive.toNumber() }))
            .catch(() => null)
        )
      ).then((results) => {
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const r of results) if (r) map[r.key] = r.price;
        const holderKey = game.currentHolder.toBase58();
        if (map[holderKey] != null) setHolderPriceAtReceive(map[holderKey]);
        setPlayerEntryPrices(map);
      });
    };
    tryFetch();
    const id = setInterval(tryFetch, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [game.currentHolder.toBase58(), "active" in game.status]);

  const { label, color } = statusLabel(game.status);
  const direction = "long" in game.direction ? "LONG" : "SHORT";
  const dirColor = direction === "LONG" ? "text-green-400" : "text-red-400";
  const timerExpired = game.endsAt.toNumber() <= Math.floor(Date.now() / 1000);
  const isActive = "active" in game.status && !timerExpired;

  const solPriceNow = game.solPriceNow?.toNumber() ?? 0;
  const effectivePriceNow = price !== null ? Math.round(price * 1e8) : (solPriceNow > 0 ? solPriceNow : 0);
  const liveScoreBp =
    isActive && holderPriceAtReceive != null && effectivePriceNow > 0
      ? calcScorePreview(
          "long" in game.direction ? "long" : "short",
          holderPriceAtReceive,
          effectivePriceNow
        )
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border ${color} border-current`}>
            {label}
          </span>
          <span className={`text-sm font-bold ${dirColor}`}>{direction}</span>
        </div>
        <div className="text-sm text-gray-400 font-mono">{timeLeft}</div>
      </div>

      {/* Price */}
      <div className="text-center">
        <div className="text-xs text-gray-500 mb-1">SOL/USD</div>
        <div className="text-3xl font-mono font-bold text-white">
          {price !== null ? `$${price.toFixed(4)}` : "—"}
        </div>
        {game.startPrice.toNumber() > 0 && (
          <div className="text-xs text-gray-500 mt-1">
            Start: ${(game.startPrice.toNumber() * 1e-8).toFixed(4)}
          </div>
        )}
      </div>

      {/* Chart */}
      <PriceChart
        price={price}
        startPrice={game.startPrice.toNumber() > 0 ? game.startPrice.toNumber() * 1e-8 : null}
      />

      {/* Scores */}
      <ScoreDisplay
        game={game}
        currentWallet={publicKey}
        liveScoreBp={liveScoreBp}
        holderWallet={game.currentHolder}
        playerEntryPrices={playerEntryPrices}
      />

      {/* Session — created at join/create time; only show renew if expired */}
      {isActive && (
        <div className="border border-gray-800 rounded p-3 space-y-2">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Session Key</div>
          {isExpired ? (
            <button
              onClick={createSession}
              className="w-full py-2 bg-blue-800 hover:bg-blue-700 text-white text-sm rounded"
            >
              Renew Session
            </button>
          ) : sessionExists ? (
            <div className="text-xs text-green-400">Session active</div>
          ) : (
            <div className="text-xs text-gray-500">Session created at game join</div>
          )}
        </div>
      )}

      {/* Pass */}
      {isActive && (
        <PassButton
          game={game}
          gamePDA={gamePDA}
          tempKeypair={sessionExists && !isExpired ? tempKeypairRef.current : null}
          sessionTokenPDA={sessionExists && !isExpired ? sessionTokenPDARef.current : null}
        />
      )}
    </div>
  );
}
