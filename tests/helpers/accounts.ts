import { Keypair, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import fs from "fs";

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
