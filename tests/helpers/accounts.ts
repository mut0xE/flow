import { Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import fs from "fs";
import { Flow } from "../../target/types/flow";

export const GAME_SEED = Buffer.from("game");
export const VAULT_SEED = Buffer.from("vault");
export const PLAYER_SEED = Buffer.from("player");

export function getGamePDA(
  gameId: BN,
  creator: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8), creator.toBuffer()],
    programId
  )[0];
}

export function getVaultPDA(
  gamePDA: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, gamePDA.toBuffer()],
    programId
  )[0];
}

export function getPlayerPDA(
  gamePDA: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PLAYER_SEED, gamePDA.toBuffer(), wallet.toBuffer()],
    programId
  )[0];
}

// Load player from file
export function loadPlayer(filePath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

// ── Delegate any account to ER ────────────────────────
// accountType matches your Rust AccountType enum:
//   GameState  → { gameState: {gameid, creator: PublicKey } }
//   PlayerAccount → { playerAccount: { player: PublicKey,game: PublicKey } }
export async function delegateToEr(
  program: Program<Flow>,
  connection: Connection,
  payer: Keypair,
  pda: PublicKey,
  accountType: any,
  erValidator: PublicKey
): Promise<string> {
  const tx = await program.methods
    .delegateAccount(accountType)
    .accounts({
      payer: payer.publicKey,
      pda,
      validator: erValidator,
    })
    .transaction();

  const txHash = await sendAndConfirmTransaction(connection, tx, [payer], {
    skipPreflight: true,
    commitment: "confirmed",
  });

  return txHash;
}
