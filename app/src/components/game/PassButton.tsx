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
  console.log("PASS ACCOUNTS", {
    signer: tempKeypair?.publicKey?.toBase58(),
    sessionToken: sessionTokenPDA?.toBase58(),
  });

  console.log("PASS DEBUG", {
    wallet: publicKey?.toBase58(),
    currentHolder: game.currentHolder.toBase58(),
    players: game.players.map((p) => p.toBase58()),
  });

  const isMyTurn =
    publicKey && game.currentHolder.toBase58() === publicKey.toBase58();
  const isActive = "active" in game.status;

  const handlePass = useCallback(async () => {
    if (!selected || !publicKey || !tempKeypair || !sessionTokenPDA) return;
    setLoading(true);
    setError(null);
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

      console.log("PASS TX ERR", txInfo?.meta?.err);
      console.log("PASS LOGS", txInfo?.meta?.logMessages);

      if (txInfo?.meta?.err) {
        throw new Error(
          "Pass failed: " +
            JSON.stringify(txInfo.meta.err) +
            "\n" +
            (txInfo?.meta?.logMessages ?? []).join("\n")
        );
      }

      await erConnection.confirmTransaction(
        { blockhash, lastValidBlockHeight, signature: sig },
        "confirmed"
      );
      setSelected(null);
      onPass?.();
    } catch (e: any) {
      setError(e?.message ?? "Pass failed");
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
        <div className="text-xs text-gray-500 uppercase tracking-wider">Pass Potato To</div>
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
        Pass potato to
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
      {error && <div className="text-red-400 text-xs">{error}</div>}
      <button
        onClick={handlePass}
        disabled={!selected || !sessionTokenPDA || loading}
        className="w-full py-3 bg-amber-600 hover:bg-amber-500 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded transition-colors"
      >
        {loading ? "Passing..." : "PASS 🥔"}
      </button>
    </div>
  );
}
