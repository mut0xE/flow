"use client";
import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { GameState } from "@/types/game";
import { getErConnection } from "@/lib/connections";
import { getProgram } from "@/lib/anchor";
import { getPlayerPDA } from "@/lib/pdas";
import { ORACLE_SOL_USD } from "@/lib/oracle";
import { SESSION_PROGRAM_ID } from "@/lib/session";

const ER_EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app%2F`;

function parseError(e: any): string {
  if (e?.error?.errorMessage) return e.error.errorMessage;
  const logs: string[] =
    e?.logs ?? (typeof e?.getLogs === "function" ? e.getLogs() : []) ?? [];
  for (const log of logs) {
    const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/);
    if (anchor) return anchor[1].trim();
    const msg = log.match(/Error Message: (.+)/);
    if (msg) return msg[1].trim();
  }
  const raw: string = e?.message ?? String(e);
  const simMatch = raw.match(/Transaction simulation failed: (.+?)(?:\. Logs:|$)/);
  if (simMatch) return simMatch[1].trim();
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

interface Props {
  game: GameState;
  gamePDA: PublicKey;
  tempKeypair: Keypair | null;
  sessionTokenPDA: PublicKey | null;
  onPass?: () => void;
}

export function PassButton({
  game,
  gamePDA,
  tempKeypair,
  sessionTokenPDA,
  onPass,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const otherPlayers = game.players.filter(
    (p) => p.toBase58() !== game.currentHolder.toBase58()
  );
  const [selected, setSelected] = useState<string | null>(
    otherPlayers.length === 1 ? otherPlayers[0].toBase58() : null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const isMyTurn =
    publicKey && game.currentHolder.toBase58() === publicKey.toBase58();
  const isActive = "active" in game.status;

  const handlePass = useCallback(async () => {
    if (!selected || !publicKey || !tempKeypair || !sessionTokenPDA) return;
    setLoading(true);
    setError(null);
    setTxSig(null);
    try {
      const erConnection = getErConnection();
      const nextPlayer = new PublicKey(selected);
      const sessionInfo = await erConnection.getAccountInfo(sessionTokenPDA);
      if (!sessionInfo?.owner.equals(SESSION_PROGRAM_ID)) {
        throw new Error(
          "Session key is missing or stale on ER. Renew the session, wait a few seconds, then pass again."
        );
      }
      const provider = new AnchorProvider(
        erConnection,
        {
          publicKey,
          signTransaction: signTransaction as any,
          signAllTransactions: undefined as any,
        },
        { commitment: "confirmed" }
      );
      const program = getProgram(provider);

      const holderPlayerPDA = getPlayerPDA(gamePDA, game.currentHolder)[0];
      const nextPlayerPDA = getPlayerPDA(gamePDA, nextPlayer)[0];

      const accounts: any = {
        game: gamePDA,
        holderPlayer: holderPlayerPDA,
        nextPlayer: nextPlayerPDA,
        signer: tempKeypair.publicKey,
        priceFeed: ORACLE_SOL_USD,
      };
      accounts.sessionToken = sessionTokenPDA;

      const tx = await (program.methods as any)
        .pass()
        .accounts(accounts)
        .transaction();

      const {
        value: { blockhash, lastValidBlockHeight },
      } = await erConnection.getLatestBlockhashAndContext();
      tx.recentBlockhash = blockhash;
      tx.feePayer = tempKeypair.publicKey;
      tx.sign(tempKeypair);

      const sig = await erConnection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
      });

      const txInfo = await erConnection.getTransaction(sig, {
        maxSupportedTransactionVersion: 0,
      });

      if (txInfo?.meta?.err) {
        const errLogs = txInfo?.meta?.logMessages ?? [];
        let reason = "";
        for (const log of errLogs) {
          const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/);
          if (anchor) { reason = anchor[1].trim(); break; }
          const msg = log.match(/Error Message: (.+)/);
          if (msg) { reason = msg[1].trim(); break; }
        }
        throw new Error(reason || "Pass failed: " + JSON.stringify(txInfo.meta.err));
      }

      await erConnection.confirmTransaction(
        { blockhash, lastValidBlockHeight, signature: sig },
        "confirmed"
      );
      setTxSig(sig);
      setSelected(null);
      onPass?.();
    } catch (e: any) {
      setError(parseError(e));
    } finally {
      setLoading(false);
    }
  }, [
    selected,
    publicKey,
    tempKeypair,
    sessionTokenPDA,
    gamePDA,
    game,
    signTransaction,
    onPass,
  ]);

  if (!isActive) return null;

  if (!isMyTurn) {
    return (
      <div className="space-y-3">
        <div className="text-xs text-gray-500 uppercase tracking-wider">Pass Position</div>
        <button
          disabled
          className="w-full py-3 bg-gray-800 text-gray-600 font-bold rounded cursor-not-allowed"
        >
          Waiting for {game.currentHolder.toBase58().slice(0, 4)}…{game.currentHolder.toBase58().slice(-4)} to pass
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider">
        Pass Position To
      </div>
      <div className="flex flex-wrap gap-2">
        {otherPlayers.map((p) => (
          <button
            key={p.toBase58()}
            onClick={() => setSelected(p.toBase58())}
            className={`px-3 py-1.5 rounded text-sm font-mono border transition-colors ${
              selected === p.toBase58()
                ? "bg-amber-600 border-amber-500 text-white"
                : "bg-gray-900 border-gray-700 text-gray-300 hover:border-amber-600"
            }`}
          >
            {p.toBase58().slice(0, 4)}…{p.toBase58().slice(-4)}
          </button>
        ))}
      </div>
      {!sessionTokenPDA && (
        <div className="text-amber-400 text-xs">Create or renew your session before passing.</div>
      )}
      {error && (
        <div className="flex items-start gap-2 text-sm bg-red-950/40 border border-red-800 rounded px-3 py-2">
          <span className="text-red-400 mt-0.5 shrink-0">✕</span>
          <span className="text-red-300">{error}</span>
        </div>
      )}
      {txSig && (
        <a
          href={ER_EXPLORER(txSig)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs font-mono text-blue-400 underline hover:text-blue-300 text-center"
        >
          ↗ Pass tx confirmed: {txSig.slice(0, 8)}…{txSig.slice(-8)}
        </a>
      )}
      <button
        onClick={handlePass}
        disabled={!selected || !sessionTokenPDA || loading}
        className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded transition-colors"
      >
        {loading ? "Passing..." : "PASS"}
      </button>
    </div>
  );
}
