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
  readSessionValidUntil,
  SESSION_PROGRAM_ID,
} from "@/lib/session";
import { FLOW_PROGRAM_ADDRESS } from "@/generated/programs/flow";

const PROGRAM_ID = new PublicKey(FLOW_PROGRAM_ADDRESS);
import { l1Connection, getErConnection } from "@/lib/connections";

async function waitForErSession(pda: PublicKey, timeoutMs = 6_000): Promise<boolean> {
  const erConn = getErConnection();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await erConn.getAccountInfo(pda);
      if (info && info.owner.equals(SESSION_PROGRAM_ID)) return true;
    } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

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
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [nowEpoch, setNowEpoch] = useState(() => Math.floor(Date.now() / 1000));
  const tempKeypairRef = useRef<Keypair | null>(null);
  const sessionTokenPDARef = useRef<PublicKey | null>(null);
  // Track the last wallet key we successfully resolved, so a transient provider=null
  // during wallet reconnect doesn't wipe state for the same key.
  const resolvedForKey = useRef<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNowEpoch(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // If wallet fully disconnected, clear everything.
    if (!publicKey) {
      setSessionExists(false);
      setSessionLoading(false);
      setSessionExpiresAt(null);
      tempKeypairRef.current = null;
      sessionTokenPDARef.current = null;
      resolvedForKey.current = null;
      return;
    }

    const walletKey = publicKey.toBase58();

    // If same wallet and we already have a valid session cached, skip re-check.
    // Provider can be transiently null during wallet reconnect — don't wipe state for same key.
    if (resolvedForKey.current === walletKey && sessionExists && tempKeypairRef.current && sessionTokenPDARef.current) {
      return;
    }

    // Different wallet key — reset
    if (resolvedForKey.current && resolvedForKey.current !== walletKey) {
      setSessionExists(false);
      setSessionExpiresAt(null);
      tempKeypairRef.current = null;
      sessionTokenPDARef.current = null;
      resolvedForKey.current = null;
    }

    // Need a provider to decode session. If provider not ready yet, wait.
    if (!provider) return;

    let cancelled = false;
    setSessionLoading(true);

    (async () => {
      try {
        const { sessionKp, sessionPDA } = await getSessionIdentity(publicKey, l1Connection);
        if (cancelled) return;

        const info = await l1Connection.getAccountInfo(sessionPDA);
        if (cancelled) return;

        if (!info || !info.owner.equals(SESSION_PROGRAM_ID)) {
          tempKeypairRef.current = sessionKp;
          sessionTokenPDARef.current = sessionPDA;
          setSessionExists(false);
          setSessionLoading(false);
          return;
        }

        try {
          const prog = await getSessionProgram(provider);
          if (cancelled) return;
          const tok: any = await ((prog.account as any).sessionTokenV2 ?? (prog.account as any).sessionToken).fetch(sessionPDA);
          if (cancelled) return;

          const onChainSigner: PublicKey = tok.sessionSigner ?? tok.session_signer ?? tok.signerKey;
          let resolvedKp = sessionKp;

          if (onChainSigner && !onChainSigner.equals(sessionKp.publicKey)) {
            const { deriveTempKeypair, sessionNonceKey } = await import("@/lib/session");
            const nonceKey = sessionNonceKey(publicKey);
            const storedNonce = Number(localStorage.getItem(nonceKey) ?? "0");
            let found = false;
            for (let n = Math.max(0, storedNonce - 20); n <= storedNonce + 5; n++) {
              const candidate = deriveTempKeypair(publicKey, String(n));
              if (candidate.publicKey.equals(onChainSigner)) {
                resolvedKp = candidate;
                localStorage.setItem(nonceKey, String(n));
                found = true;
                break;
              }
            }
            if (!found) {
              if (!cancelled) {
                setSessionExists(false);
                setSessionLoading(false);
              }
              return;
            }
          }

          if (cancelled) return;
          const exp =
            typeof tok.validUntil?.toNumber === "function"
              ? tok.validUntil.toNumber()
              : Number(tok.validUntil);

          // Check expiry before waiting for ER
          if (exp <= Math.floor(Date.now() / 1000)) {
            if (!cancelled) {
              setSessionExists(false);
              setSessionExpiresAt(exp);
              setSessionLoading(false);
            }
            return;
          }

          // Trust L1 session is valid; ER replication is fast (<1s usually).
          // Pass will surface an error if ER hasn't caught up yet.
          tempKeypairRef.current = resolvedKp;
          sessionTokenPDARef.current = sessionPDA;
          resolvedForKey.current = walletKey;
          setSessionExists(true);
          setSessionExpiresAt(exp);
          setSessionLoading(false);
        } catch {
          const validUntil = readSessionValidUntil(info.data as Buffer);
          if (!validUntil || validUntil <= Math.floor(Date.now() / 1000)) {
            if (!cancelled) {
              setSessionExists(false);
              setSessionLoading(false);
            }
            return;
          }
          tempKeypairRef.current = sessionKp;
          sessionTokenPDARef.current = sessionPDA;
          resolvedForKey.current = walletKey;
          setSessionExists(true);
          setSessionExpiresAt(validUntil);
          setSessionLoading(false);
        }
      } catch {
        if (!cancelled) setSessionLoading(false);
      }
    })();

    return () => { cancelled = true; };
  // Re-run when wallet or provider changes, but guard inside against same-wallet provider flap.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey?.toBase58(), !!provider]);

  // Allow external callers to force a recheck (e.g. after "Invalid session token" error)
  const invalidateSession = useCallback(() => {
    resolvedForKey.current = null;
    setSessionExists(false);
    setSessionExpiresAt(null);
    tempKeypairRef.current = null;
    sessionTokenPDARef.current = null;
  }, []);

  const createSession = useCallback(async () => {
    if (!publicKey || !provider || !signTransaction) return;
    const nonceKey = sessionNonceKey(publicKey);
    const sessionProgram = await getSessionProgram(provider);
    const validUntil = new BN(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
    const topUpLamports = new BN(Math.round(0.002 * LAMPORTS_PER_SOL));

    let freshKp: Keypair;
    let pda: PublicKey;
    let attempts = 0;
    while (true) {
      localStorage.setItem(
        nonceKey,
        String((Number(localStorage.getItem(nonceKey) ?? "0") + 1) | 0)
      );
      const identity = await getSessionIdentity(publicKey, l1Connection);
      freshKp = identity.sessionKp;
      pda = identity.sessionPDA;

      const pdaInfo = await l1Connection.getAccountInfo(pda);
      const pdaValidUntil = pdaInfo ? readSessionValidUntil(pdaInfo.data as Buffer) : 0;
      if (pdaInfo && pdaInfo.owner.equals(SESSION_PROGRAM_ID) && pdaValidUntil > Math.floor(Date.now() / 1000)) {
        try {
          const tok: any = await ((sessionProgram.account as any).sessionTokenV2 ?? (sessionProgram.account as any).sessionToken).fetch(pda);
          const onChainSigner: PublicKey = tok.sessionSigner ?? tok.session_signer ?? tok.signerKey;
          if (onChainSigner && !onChainSigner.equals(freshKp.publicKey)) {
            const { deriveTempKeypair } = await import("@/lib/session");
            const storedNonce = Number(localStorage.getItem(nonceKey) ?? "0");
            for (let n = Math.max(0, storedNonce - 20); n <= storedNonce + 5; n++) {
              const candidate = deriveTempKeypair(publicKey, String(n));
              if (candidate.publicKey.equals(onChainSigner)) {
                freshKp = candidate;
                break;
              }
            }
          }
        } catch { /* fall through */ }
        tempKeypairRef.current = freshKp!;
        sessionTokenPDARef.current = pda;
        resolvedForKey.current = publicKey.toBase58();
        setSessionExists(true);
        setSessionExpiresAt(pdaValidUntil);
        return;
      }

      const signerInfo = await l1Connection.getAccountInfo(freshKp.publicKey);
      if (!signerInfo) break;
      if (++attempts > 5) throw new Error("Unable to find a free session keypair after 5 attempts");
    }

    tempKeypairRef.current = freshKp!;
    sessionTokenPDARef.current = pda!;

    const tx: Transaction = await (sessionProgram.methods as any)
      .createSessionV2(true, validUntil, topUpLamports)
      .accounts({
        sessionToken: pda!,
        targetProgram: PROGRAM_ID,
        sessionSigner: freshKp!.publicKey,
        feePayer: publicKey,
        authority: publicKey,
      })
      .transaction();

    const { value: { blockhash, lastValidBlockHeight } } = await l1Connection.getLatestBlockhashAndContext();
    tx.recentBlockhash = blockhash;
    tx.feePayer = publicKey;
    tx.sign(freshKp!);
    const signed = await signTransaction(tx);
    const sig = await l1Connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await l1Connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed");

    // Wait for ER replication
    const erConn = getErConnection();
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const erInfo = await erConn.getAccountInfo(pda!);
      if (erInfo && erInfo.owner.equals(SESSION_PROGRAM_ID)) break;
      await new Promise((r) => setTimeout(r, 800));
    }

    resolvedForKey.current = publicKey.toBase58();
    setSessionExists(true);
    setSessionExpiresAt(Math.floor(Date.now() / 1000) + 30 * 24 * 3600);
  }, [publicKey, provider, signTransaction]);

  const isExpired = sessionExpiresAt !== null && nowEpoch >= sessionExpiresAt;

  return {
    tempKeypairRef,
    sessionTokenPDARef,
    sessionExists,
    sessionLoading,
    sessionExpiresAt,
    isExpired,
    createSession,
    invalidateSession,
  };
}
