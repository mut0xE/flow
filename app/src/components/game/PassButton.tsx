"use client";
import { useState, useCallback, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { type Address } from "@solana/kit";
import { GameState } from "@/types/game";
import { GameStatus } from "@/generated/types/gameStatus";
import { getErConnection } from "@/lib/connections";
import { getPassInstruction } from "@/generated/instructions/pass";
import { getPlayerPDA } from "@/lib/pdas";
import { ORACLE_SOL_USD } from "@/lib/oracle";
import { toWeb3Ix } from "@/lib/ix";
import { useTxToast } from "@/components/shell/TxToast";

const ER_EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app%2F`;

function parseError(e: any): string {
  if (e?.error?.errorMessage) return e.error.errorMessage;
  const logs: string[] = e?.logs ?? (typeof e?.getLogs === "function" ? e.getLogs() : []) ?? [];
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
  onNeedSession?: () => void;
}

export function PassButton({ game, gamePDA, tempKeypair, sessionTokenPDA, onPass, onNeedSession }: Props) {
  const { publicKey, signTransaction } = useWallet();
  const { addToast } = useTxToast();
  const otherPlayers = game.players.filter((p) => p !== game.currentHolder);
  const [selected, setSelected] = useState<string | null>(() =>
    otherPlayers.length === 1 ? (otherPlayers[0] as string) : null
  );

  // Reset selection whenever the holder changes (after a pass the old selected value is stale)
  useEffect(() => {
    setSelected(otherPlayers.length === 1 ? (otherPlayers[0] as string) : null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.currentHolder]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const isMyTurn = publicKey && game.currentHolder === publicKey.toBase58();
  const isActive = game.status === GameStatus.Active;

  // If only one other player, always derive selection automatically so a stale
  // null (set after a pass) never leaves the button permanently disabled.
  const effectiveSelected = selected ?? (otherPlayers.length === 1 ? (otherPlayers[0] as string) : null);

  const handlePass = useCallback(async () => {
    if (!effectiveSelected || !publicKey || !tempKeypair || !sessionTokenPDA || !signTransaction) return;
    setLoading(true); setError(null); setTxSig(null);
    try {
      const erConnection = getErConnection();
      const nextPlayer = new PublicKey(effectiveSelected);
      const holderPlayerPDA = getPlayerPDA(gamePDA, new PublicKey(game.currentHolder as string))[0];
      const nextPlayerPDA = getPlayerPDA(gamePDA, nextPlayer)[0];
      const passIx = getPassInstruction({
        signer: { address: tempKeypair.publicKey.toBase58() as Address, signTransactions: async (t: any) => t } as any,
        game: gamePDA.toBase58() as Address,
        holderPlayer: holderPlayerPDA.toBase58() as Address,
        nextPlayer: nextPlayerPDA.toBase58() as Address,
        sessionToken: sessionTokenPDA.toBase58() as Address,
        priceFeed: ORACLE_SOL_USD.toBase58() as Address,
      });
      const tx = new Transaction().add(toWeb3Ix(passIx));
      const { value: { blockhash, lastValidBlockHeight } } = await erConnection.getLatestBlockhashAndContext();
      tx.recentBlockhash = blockhash; tx.feePayer = tempKeypair.publicKey; tx.sign(tempKeypair);
      const sig = await erConnection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await erConnection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed");
      const txInfo = await erConnection.getTransaction(sig, { maxSupportedTransactionVersion: 0 });
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
      setTxSig(sig); setSelected(null); onPass?.();
      addToast({ label: "PASSED ▶", sig, variant: "success", erExplorer: true });
    } catch (e: any) {
      const msg = parseError(e);
      setError(msg);
      addToast({ label: "PASS FAILED", variant: "error" });
      // If the chain rejected the session token, invalidate it so the UI shows the renew flow.
      const isSessionError =
        msg.toLowerCase().includes("invalid session") ||
        msg.toLowerCase().includes("session token") ||
        msg.toLowerCase().includes("invalidtoken") ||
        msg.toLowerCase().includes("invalid token");
      if (isSessionError) onNeedSession?.();
    } finally {
      setLoading(false);
    }
  }, [effectiveSelected, publicKey, tempKeypair, sessionTokenPDA, gamePDA, game, signTransaction, onPass]);

  // Not the holder — show waiting state
  if (!isActive) return null;

  if (!isMyTurn) {
    const holderShort = `${(game.currentHolder as string).slice(0, 4)}…${(game.currentHolder as string).slice(-4)}`;
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Press Start 2P', monospace", fontSize: 9,
        border: "3px solid var(--navy)", background: "var(--lavender)",
        color: "var(--text-muted)", boxShadow: "4px 4px 0 var(--navy)", padding: 14,
        letterSpacing: 1,
      }}>
        WAITING FOR {holderShort} …
      </div>
    );
  }

  // It's my turn — need a valid session to pass
  if (!tempKeypair || !sessionTokenPDA) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {otherPlayers.length > 1 && (
        <div>
          <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", marginBottom: 8 }}>PASS TO</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {otherPlayers.map((p) => {
              const sel = selected === (p as string);
              return (
                <button key={p as string} onClick={() => setSelected(p as string)} style={{
                  fontFamily: "'Press Start 2P', monospace", fontSize: 9,
                  border: "3px solid var(--navy)", padding: "9px 11px",
                  boxShadow: sel ? "2px 2px 0 var(--navy)" : "4px 4px 0 var(--navy)",
                  transform: sel ? "translate(2px,2px)" : "none",
                  background: sel ? "var(--navy)" : "var(--lavender)",
                  color: sel ? "var(--yellow)" : "var(--navy)", cursor: "pointer",
                }}>
                  {(p as string).slice(0, 4)}…{(p as string).slice(-4)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error && (
        <div style={{ display: "flex", gap: 8, fontFamily: "'VT323', monospace", fontSize: 16, border: "2px solid var(--red)", background: "rgba(240,85,107,.08)", padding: "10px 12px", color: "var(--red)" }}>
          <span>✕</span><span>{error}</span>
        </div>
      )}

      <button onClick={handlePass} disabled={!effectiveSelected || loading} style={{
        width: "100%",
        fontFamily: "'Press Start 2P', monospace", fontSize: "clamp(12px,2vw,16px)",
        border: "3px solid var(--navy)",
        background: (!effectiveSelected || loading) ? "var(--text-muted)" : "var(--red)",
        color: "var(--lavender)",
        boxShadow: "5px 5px 0 var(--navy)", padding: 18,
        cursor: (!effectiveSelected || loading) ? "default" : "pointer", letterSpacing: 1,
      }}>
        {loading ? "PASSING…" : "PASS ▶"}
      </button>
    </div>
  );
}
