"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { AnchorProvider, Program } from "@coral-xyz/anchor";
import {
  sessionNonceKey,
  getSessionIdentity,
  SESSION_PROGRAM_ID,
} from "@/lib/session";
import { PROGRAM_ID } from "@/lib/anchor";
import { l1Connection } from "@/lib/connections";

// Use the app's Anchor 0.32 to build the session program — gum-sdk's nested
// Anchor 0.30 computes a garbage program ID with the 0.32 two-arg constructor.
async function getSessionProgram(provider: AnchorProvider): Promise<Program> {
  const { default: gplSessionIdl } = await import("@magicblock-labs/gum-sdk/lib/gpl_session.json");
  return new Program(gplSessionIdl as any, provider);
}

export function useSession(
  publicKey: PublicKey | null,
  provider: AnchorProvider | null,
  signTransaction: ((tx: any) => Promise<any>) | undefined
) {
  const [sessionExists, setSessionExists] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [nowEpoch, setNowEpoch] = useState(() => Math.floor(Date.now() / 1000));
  const tempKeypairRef = useRef<Keypair | null>(null);
  const sessionTokenPDARef = useRef<PublicKey | null>(null);

  useEffect(() => {
    const id = setInterval(
      () => setNowEpoch(Math.floor(Date.now() / 1000)),
      15_000
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!publicKey || !provider) {
      tempKeypairRef.current = null;
      return;
    }
    let cancelled = false;

    getSessionIdentity(publicKey, l1Connection)
      .then(({ sessionKp, sessionPDA }) => {
        if (cancelled) return;
        tempKeypairRef.current = sessionKp;
        sessionTokenPDARef.current = sessionPDA;
        return l1Connection.getAccountInfo(sessionPDA).then((info) => ({ info, sessionPDA }));
      })
      .then((result) => {
        if (!result || cancelled) return;
        const { info, sessionPDA } = result;
        if (info && info.owner.equals(SESSION_PROGRAM_ID)) {
          setSessionExists(true);
          getSessionProgram(provider)
            .then((prog) =>
              ((prog.account as any).sessionTokenV2 ?? (prog.account as any).sessionToken).fetch(sessionPDA)
                .then((tok: any) => {
                  const exp =
                    typeof tok.validUntil?.toNumber === "function"
                      ? tok.validUntil.toNumber()
                      : Number(tok.validUntil);
                  setSessionExpiresAt(exp);
                })
                .catch(() => {})
            )
            .catch(() => {});
        } else {
          setSessionExists(false);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [publicKey?.toBase58()]);

  const createSession = useCallback(async () => {
    if (!publicKey || !provider || !signTransaction) return;
    const nonceKey = sessionNonceKey(publicKey);
    localStorage.setItem(
      nonceKey,
      String((Number(localStorage.getItem(nonceKey) ?? "0") + 1) | 0)
    );
    const { sessionKp: freshKp, sessionPDA: pda } = await getSessionIdentity(publicKey, l1Connection);
    tempKeypairRef.current = freshKp;
    sessionTokenPDARef.current = pda;

    const validUntil = new BN(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
    const topUpLamports = new BN(Math.round(0.002 * LAMPORTS_PER_SOL));

    const sessionProgram = await getSessionProgram(provider);
    const tx: Transaction = await (sessionProgram.methods as any)
      .createSessionV2(true, validUntil, topUpLamports)
      .accounts({
        sessionToken: pda,
        targetProgram: PROGRAM_ID,
        sessionSigner: freshKp.publicKey,
        feePayer: publicKey,
        authority: publicKey,
      })
      .transaction();

    const {
      value: { blockhash, lastValidBlockHeight },
    } = await l1Connection.getLatestBlockhashAndContext();
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;
    tx.sign(freshKp);
    const signed = await signTransaction(tx);
    const sig = await l1Connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
    });
    await l1Connection.confirmTransaction(
      { blockhash, lastValidBlockHeight, signature: sig },
      "confirmed"
    );
    setSessionExists(true);
    setSessionExpiresAt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  }, [publicKey, provider, signTransaction]);

  const isExpired = sessionExpiresAt !== null && nowEpoch >= sessionExpiresAt;

  return {
    tempKeypairRef,
    sessionTokenPDARef,
    sessionExists,
    sessionExpiresAt,
    isExpired,
    createSession,
  };
}
