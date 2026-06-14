import { Keypair, PublicKey, TransactionInstruction, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { AnchorProvider } from "@coral-xyz/anchor"
import BN from "bn.js"
import { SessionTokenManager } from "@magicblock-labs/gum-sdk"
import { PROGRAM_ID } from "./anchor"
import { l1Connection } from "./connections"

export const SESSION_TOKEN_SEED = "session_token_v2"

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
  sessionProgramId: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_SEED),
      PROGRAM_ID.toBytes(),
      tempKeypair.publicKey.toBytes(),
      walletPublicKey.toBytes(),
    ],
    sessionProgramId
  )
  return pda
}

/** Returns the session keypair for a wallet (derives from localStorage nonce). */
export function getSessionKeypair(walletPublicKey: PublicKey): Keypair {
  const nonce = typeof window !== "undefined"
    ? (localStorage.getItem(sessionNonceKey(walletPublicKey)) ?? "0")
    : "0"
  return deriveTempKeypair(walletPublicKey, nonce)
}

/**
 * Builds a createSessionV2 instruction to bundle into another tx.
 * Call tx.partialSign(sessionKp) BEFORE the wallet signs.
 * validUntil should be the game endsAt + a small buffer.
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
  const mgr = new SessionTokenManager(provider as any, l1Connection)
  return await (mgr.program.methods as any)
    .createSessionV2(true, validUntil, new BN(Math.round(0.002 * LAMPORTS_PER_SOL)))
    .accounts({
      targetProgram: PROGRAM_ID,
      sessionSigner: sessionKp.publicKey,
      feePayer: walletPublicKey,
      authority: walletPublicKey,
    })
    .instruction()
}

/** Returns the session program ID by creating a throw-away manager. */
export function getSessionProgramId(
  walletPublicKey: PublicKey,
  signTransaction: (tx: any) => Promise<any>
): PublicKey {
  const provider = new AnchorProvider(
    l1Connection,
    { publicKey: walletPublicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
    { commitment: "confirmed" }
  )
  const mgr = new SessionTokenManager(provider as any, l1Connection)
  return mgr.program.programId
}
