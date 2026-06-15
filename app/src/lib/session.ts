import { Connection, Keypair, PublicKey, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { AnchorProvider, Program } from "@coral-xyz/anchor"
import BN from "bn.js"
import { PROGRAM_ID } from "./anchor"
import { l1Connection } from "./connections"

export const SESSION_TOKEN_SEED = "session_token_v2"

// Hardcoded — gum-sdk's nested Anchor 0.30 computes a garbage program ID
// when called with the Anchor 0.32 two-arg constructor. Always use this constant.
export const SESSION_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5")

export function sessionNonceKey(pk: PublicKey): string {
  return `sessionNonce:${pk.toBase58()}`
}

export function deriveTempKeypair(walletPubkey: PublicKey, nonce: string): Keypair {
  const seedBytes = new Uint8Array(32)
  const raw = walletPubkey.toBytes()
  const src = new TextEncoder().encode(walletPubkey.toBase58() + ":" + nonce)
  for (let i = 0; i < 32; i++) seedBytes[i] = raw[i] ^ (src[i % src.length] ?? 0)
  return Keypair.fromSeed(seedBytes)
}

export function getSessionTokenPDA(
  tempKeypair: Keypair,
  walletPublicKey: PublicKey,
  // sessionProgramId param kept for API compat but SESSION_PROGRAM_ID is always used
  _sessionProgramId?: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      PROGRAM_ID.toBytes(),
      tempKeypair.publicKey.toBytes(),
      walletPublicKey.toBytes(),
    ],
    SESSION_PROGRAM_ID
  )
  return pda
}

export async function getSessionIdentity(
  walletPublicKey: PublicKey,
  connection: Connection = l1Connection
): Promise<{ sessionKp: Keypair; sessionPDA: PublicKey; exists: boolean }> {
  const nonceKey = sessionNonceKey(walletPublicKey)
  let nonce = typeof window !== "undefined"
    ? Number(localStorage.getItem(nonceKey) ?? "0")
    : 0

  for (let attempts = 0; attempts < 25; attempts++) {
    const sessionKp = deriveTempKeypair(walletPublicKey, String(nonce))
    const sessionPDA = getSessionTokenPDA(sessionKp, walletPublicKey)
    const info = await connection.getAccountInfo(sessionPDA)

    if (!info || info.owner.equals(SESSION_PROGRAM_ID)) {
      if (typeof window !== "undefined") {
        localStorage.setItem(nonceKey, String(nonce))
      }
      return { sessionKp, sessionPDA, exists: !!info }
    }

    nonce++
  }

  throw new Error("Could not find an unused session PDA. Clear stale session data and try again.")
}

/** Returns the session keypair for a wallet (derives from localStorage nonce). */
export function getSessionKeypair(walletPublicKey: PublicKey): Keypair {
  const nonce = typeof window !== "undefined"
    ? (localStorage.getItem(sessionNonceKey(walletPublicKey)) ?? "0")
    : "0"
  return deriveTempKeypair(walletPublicKey, nonce)
}

/** Returns the session-keys program using the app's Anchor 0.32 (correct program ID). */
async function getSessionProgram(provider: AnchorProvider): Promise<Program> {
  // Dynamic import avoids bundling the full IDL at module load time
  const { default: gplSessionIdl } = await import("@magicblock-labs/gum-sdk/lib/gpl_session.json")
  return new Program(gplSessionIdl as any, provider)
}

/**
 * Builds a createSessionV2 instruction to bundle into another tx.
 * Call tx.partialSign(sessionKp) BEFORE the wallet signs.
 */
export async function buildCreateSessionIx(
  walletPublicKey: PublicKey,
  signTransaction: (tx: any) => Promise<any>,
  sessionKp: Keypair,
  validUntil: BN
): Promise<TransactionInstruction> {
  const provider = new AnchorProvider(
    l1Connection,
    { publicKey: walletPublicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
    { commitment: "confirmed" }
  )
  const sessionProgram = await getSessionProgram(provider)
  return await (sessionProgram.methods as any)
    .createSessionV2(true, validUntil, new BN(Math.round(0.002 * LAMPORTS_PER_SOL)))
    .accounts({
      sessionToken: getSessionTokenPDA(sessionKp, walletPublicKey),
      targetProgram: PROGRAM_ID,
      sessionSigner: sessionKp.publicKey,
      feePayer: walletPublicKey,
      authority: walletPublicKey,
    })
    .instruction()
}

/** Returns the session program ID (always the correct hardcoded value). */
export function getSessionProgramId(
  _walletPublicKey?: PublicKey,
  _signTransaction?: (tx: any) => Promise<any>
): PublicKey {
  return SESSION_PROGRAM_ID
}
