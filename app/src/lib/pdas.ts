import { PublicKey } from "@solana/web3.js"
import BN from "bn.js"
import { FLOW_PROGRAM_ADDRESS } from "@/generated/programs/flow"

const PROGRAM_ID = new PublicKey(FLOW_PROGRAM_ADDRESS)

const GAME_SEED   = Buffer.from("game")
const VAULT_SEED  = Buffer.from("vault")
const PLAYER_SEED = Buffer.from("player")

export function getGamePDA(gameId: BN, creator: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [GAME_SEED, gameId.toArrayLike(Buffer, "le", 8), creator.toBuffer()],
    PROGRAM_ID
  )
}

export function getVaultPDA(gamePDA: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([VAULT_SEED, gamePDA.toBuffer()], PROGRAM_ID)
}

export function getPlayerPDA(gamePDA: PublicKey, wallet: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PLAYER_SEED, gamePDA.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  )
}
