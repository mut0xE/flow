"use client"
import { useState, useRef, useEffect, useCallback } from "react"
import { PublicKey, LAMPORTS_PER_SOL, Keypair, Transaction } from "@solana/web3.js"
import BN from "bn.js"
import { AnchorProvider } from "@coral-xyz/anchor"
import { SessionTokenManager } from "@magicblock-labs/gum-sdk"
import { deriveTempKeypair, sessionNonceKey, getSessionTokenPDA } from "@/lib/session"
import { PROGRAM_ID } from "@/lib/anchor"
import { l1Connection } from "@/lib/connections"

export function useSession(
  publicKey: PublicKey | null,
  provider: AnchorProvider | null,
  signTransaction: ((tx: any) => Promise<any>) | undefined
) {
  const [sessionExists, setSessionExists] = useState(false)
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null)
  const [nowEpoch, setNowEpoch] = useState(() => Math.floor(Date.now() / 1000))
  const tempKeypairRef = useRef<Keypair | null>(null)
  const sessionTokenPDARef = useRef<PublicKey | null>(null)
  const managerRef = useRef<SessionTokenManager | null>(null)

  useEffect(() => {
    const id = setInterval(() => setNowEpoch(Math.floor(Date.now() / 1000)), 15_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!publicKey || !provider) { tempKeypairRef.current = null; return }
    const nonce = typeof window !== "undefined"
      ? (localStorage.getItem(sessionNonceKey(publicKey)) ?? "0")
      : "0"
    const kp = deriveTempKeypair(publicKey, nonce)
    tempKeypairRef.current = kp
    const mgr = new SessionTokenManager(provider as any, l1Connection)
    managerRef.current = mgr
    const pda = getSessionTokenPDA(kp, publicKey, mgr.program.programId)
    sessionTokenPDARef.current = pda
    l1Connection.getAccountInfo(pda).then(info => {
      if (info) {
        setSessionExists(true)
        mgr.get(pda).then((tok: any) => {
          const exp = typeof tok.validUntil?.toNumber === "function"
            ? tok.validUntil.toNumber()
            : Number(tok.validUntil)
          setSessionExpiresAt(exp)
        }).catch(() => {})
      } else {
        setSessionExists(false)
      }
    }).catch(() => {})
  }, [publicKey?.toBase58()])

  const createSession = useCallback(async () => {
    if (!publicKey || !provider || !signTransaction || !managerRef.current) return
    const nonceKey = sessionNonceKey(publicKey)
    const nextNonce = String((Number(localStorage.getItem(nonceKey) ?? "0") + 1) | 0)
    localStorage.setItem(nonceKey, nextNonce)
    const freshKp = deriveTempKeypair(publicKey, nextNonce)
    tempKeypairRef.current = freshKp
    const mgr = managerRef.current
    const pda = getSessionTokenPDA(freshKp, publicKey, mgr.program.programId)
    sessionTokenPDARef.current = pda

    const validUntil = new BN(Math.floor(Date.now() / 1000) + 3600)
    const topUpLamports = new BN(Math.round(0.002 * LAMPORTS_PER_SOL))

    const tx: Transaction = await (mgr.program.methods as any)
      .createSessionV2(true, validUntil, topUpLamports)
      .accounts({ targetProgram: PROGRAM_ID, sessionSigner: freshKp.publicKey, feePayer: publicKey, authority: publicKey })
      .transaction()

    const { value: { blockhash, lastValidBlockHeight } } = await l1Connection.getLatestBlockhashAndContext()
    tx.recentBlockhash = blockhash
    tx.feePayer = publicKey
    tx.sign(freshKp)
    const signed = await signTransaction(tx)
    const sig = await l1Connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
    await l1Connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed")
    setSessionExists(true)
    setSessionExpiresAt(Math.floor(Date.now() / 1000) + 3600)
  }, [publicKey, provider, signTransaction])

  const isExpired = sessionExpiresAt !== null && nowEpoch >= sessionExpiresAt

  return {
    tempKeypairRef,
    sessionTokenPDARef,
    sessionExists,
    sessionExpiresAt,
    isExpired,
    createSession,
  }
}
