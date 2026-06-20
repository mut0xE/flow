"use client";
import { useCallback, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { type Address } from "@solana/kit";
import { Direction } from "@/generated/types/direction";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { l1Connection } from "@/lib/connections";
import { toWeb3Ix } from "@/lib/ix";
import { getCreateGameInstructionAsync } from "@/generated/instructions/createGame";
import { getSessionIdentity, buildCreateSessionIx } from "@/lib/session";
import BN from "bn.js";
import { useTxToast } from "@/components/shell/TxToast";

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

interface FormValues {
  direction: "long" | "short";
  entryFeeSol: string;
  lossLimit: string;
  maxPlayers: string;
  durationMinutes: string;
}

const chip = (sel: boolean): React.CSSProperties => ({
  fontFamily: "'Press Start 2P', monospace",
  fontSize: 11,
  padding: "11px 14px",
  border: "3px solid var(--navy)",
  boxShadow: sel ? "2px 2px 0 var(--navy)" : "4px 4px 0 var(--navy)",
  transform: sel ? "translate(2px,2px)" : "none",
  background: sel ? "var(--navy)" : "var(--lavender)",
  color: sel ? "var(--yellow)" : "var(--navy)",
  cursor: "pointer",
  flex: 1,
});

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontFamily: "'VT323', monospace",
  fontSize: 20,
  border: "3px solid var(--navy)",
  background: "var(--lavender)",
  color: "var(--navy)",
  padding: "10px 13px",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontFamily: "'VT323', monospace",
  fontSize: 17,
  color: "var(--text-muted)",
  letterSpacing: 1,
  marginBottom: 8,
  display: "block",
};

export function CreateGameForm() {
  const { publicKey, sendTransaction } = useWallet();
  const router = useRouter();
  const { addToast } = useTxToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: { direction: "long", entryFeeSol: "0.01", lossLimit: "5", maxPlayers: "2", durationMinutes: "10" },
  });
  const direction = watch("direction");
  const maxPlayers = parseInt(watch("maxPlayers") || "2");

  const onSubmit = useCallback(async (values: FormValues) => {
    if (!publicKey) { setError("Wallet not connected."); return; }
    setLoading(true); setError(null);
    try {
      const creatorAddress = publicKey.toBase58() as Address;
      const gameId = BigInt(Math.floor(Math.random() * 2 ** 32));
      const entryFee = BigInt(Math.round(parseFloat(values.entryFeeSol) * LAMPORTS_PER_SOL));
      const lossLimit = parseInt(values.lossLimit);
      const maxP = parseInt(values.maxPlayers);
      const durationSecs = parseInt(values.durationMinutes) * 60;
      const endsAt = BigInt(Math.floor(Date.now() / 1000) + durationSecs);
      const dirArg = values.direction === "long" ? Direction.Long : Direction.Short;

      const createGameIx = await getCreateGameInstructionAsync({
        creator: { address: creatorAddress, signTransactions: async (txs: any) => txs } as any,
        gameId, direction: dirArg, entryFee, lossLimit, maxPlayers: maxP, endsAt,
      });

      const { sessionKp, exists: existingSession } = await getSessionIdentity(publicKey, l1Connection);
      const tx = new Transaction().add(toWeb3Ix(createGameIx));
      if (!existingSession) {
        const sessionValidUntil = new BN(Math.floor(Date.now() / 1000) + 6 * 24 * 3600);
        const sessionIx = await buildCreateSessionIx(publicKey, async (t: any) => t, sessionKp, sessionValidUntil);
        tx.add(sessionIx);
      }
      const { blockhash, lastValidBlockHeight } = await l1Connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash; tx.feePayer = publicKey;
      const sig = await sendTransaction(tx, l1Connection, { signers: existingSession ? [] : [sessionKp], skipPreflight: false });
      addToast({ label: "GAME CREATED", sig, variant: "success" });
      await l1Connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed");
      const { findGamePda } = await import("@/generated/pdas/game");
      const [gamePDA] = await findGamePda({ gameId, creator: creatorAddress });
      router.push(`/game/${gamePDA}`);
    } catch (e: any) {
      setError(parseError(e));
      addToast({ label: "CREATE FAILED", variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [publicKey, sendTransaction, router]);

  if (!publicKey) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px" }}>
        <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>WALLET NOT CONNECTED</div>
        <div style={{ fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)" }}>Connect your wallet to host a game.</div>
      </div>
    );
  }

  const feeSol = parseFloat(watch("entryFeeSol") || "0.01") || 0;

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <form onSubmit={handleSubmit(onSubmit)} style={{
        width: "100%", maxWidth: 540,
        border: "3px solid var(--navy)", boxShadow: "7px 7px 0 var(--navy)",
        background: "var(--lavender)", padding: "clamp(18px,3vw,28px)",
        animation: "risehud .2s ease-out both",
        display: "flex", flexDirection: "column", gap: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, color: "var(--navy)", letterSpacing: 1 }}>HOST GAME</span>
          <a href="/" style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 9, border: "3px solid var(--navy)", background: "var(--lavender)", color: "var(--navy)", boxShadow: "3px 3px 0 var(--navy)", padding: "8px 10px", cursor: "pointer", textDecoration: "none" }}>✕ CANCEL</a>
        </div>

        {/* Direction */}
        <div>
          <label style={labelStyle}>DIRECTION</label>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={() => setValue("direction", "long")} style={{ ...chip(direction === "long") }}>▲ LONG</button>
            <button type="button" onClick={() => setValue("direction", "short")} style={{ ...chip(direction === "short") }}>▼ SHORT</button>
          </div>
        </div>

        {/* Entry fee */}
        <div>
          <label style={labelStyle}>ENTRY FEE (SOL)</label>
          <input {...register("entryFeeSol")} type="number" step="0.001" min="0.001" style={inputStyle} />
        </div>

        {/* Loss limit */}
        <div>
          <label style={labelStyle}>LOSS LIMIT (%)</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[5, 10, 15].map((v) => (
              <button key={v} type="button" onClick={() => setValue("lossLimit", String(v))}
                style={{ ...chip(watch("lossLimit") === String(v)), flex: "0 1 auto", padding: "10px 14px" }}>
                {v}%
              </button>
            ))}
            <input {...register("lossLimit")} type="number" min="1" max="50" style={{ ...inputStyle, width: 80, flex: "0 0 auto" }} />
          </div>
        </div>

        {/* Max players */}
        <div>
          <label style={labelStyle}>MAX PLAYERS</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button type="button" onClick={() => setValue("maxPlayers", String(Math.max(2, maxPlayers - 1)))}
              style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, border: "3px solid var(--navy)", background: "var(--lavender)", color: "var(--navy)", boxShadow: "3px 3px 0 var(--navy)", width: 44, height: 44, cursor: "pointer" }}>−</button>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 20, minWidth: 34, textAlign: "center", color: "var(--navy)" }}>{maxPlayers}</span>
            <button type="button" onClick={() => setValue("maxPlayers", String(Math.min(8, maxPlayers + 1)))}
              style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 14, border: "3px solid var(--navy)", background: "var(--lavender)", color: "var(--navy)", boxShadow: "3px 3px 0 var(--navy)", width: 44, height: 44, cursor: "pointer" }}>+</button>
            <span style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)" }}>2 – 8 SEATS</span>
          </div>
        </div>

        {/* Duration */}
        <div>
          <label style={labelStyle}>END TIME</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[3, 5, 10].map((v) => (
              <button key={v} type="button" onClick={() => setValue("durationMinutes", String(v))}
                style={{ ...chip(watch("durationMinutes") === String(v)), flex: "0 1 auto", padding: "10px 14px" }}>
                {v}m
              </button>
            ))}
            <input {...register("durationMinutes")} type="number" min="1" max="60" style={{ ...inputStyle, width: 80, flex: "0 0 auto" }} />
          </div>
        </div>

        {/* Pool preview */}
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)", borderTop: "2px dashed var(--navy)", paddingTop: 12 }}>
          <span>POOL IF FULL</span>
          <span style={{ color: "var(--navy)", fontFamily: "'Press Start 2P', monospace", fontSize: 11 }}>
            {(feeSol * maxPlayers).toFixed(3)} ◎
          </span>
        </div>

        <div style={{ fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)" }}>
          Session key created in same tx — no extra popups.
        </div>

        {error && (
          <div style={{ display: "flex", gap: 8, fontFamily: "'VT323', monospace", fontSize: 16, border: "2px solid var(--red)", background: "rgba(240,85,107,.08)", padding: "10px 12px", color: "var(--red)" }}>
            <span>✕</span><span>{error}</span>
          </div>
        )}
        <button type="submit" disabled={loading} style={{
          width: "100%",
          fontFamily: "'Press Start 2P', monospace", fontSize: 13,
          border: "3px solid var(--navy)", background: loading ? "var(--text-muted)" : "var(--navy)",
          color: loading ? "var(--navy)" : "var(--lavender)",
          boxShadow: "5px 5px 0 var(--navy)", padding: 18, cursor: loading ? "default" : "pointer", letterSpacing: 1,
        }}>
          {loading ? "CREATING…" : "CREATE GAME ▶"}
        </button>
      </form>
    </div>
  );
}
