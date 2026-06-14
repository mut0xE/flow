import { PublicKey } from "@solana/web3.js"
import BN from "bn.js"

export type Direction = { long: {} } | { short: {} }
export type GameStatus = { waiting: {} } | { active: {} } | { ended: {} } | { settled: {} }

export interface GameState {
  gameId: BN
  creator: PublicKey
  direction: Direction
  entryFee: BN
  lossLimit: number
  maxPlayers: number
  playerCount: number
  players: PublicKey[]
  scores: BN[]
  totalDeposited: BN
  status: GameStatus
  currentHolder: PublicKey
  finalPrice: BN
  startPrice: BN
  solPriceNow: BN
  createdAt: BN
  startedAt: BN
  endsAt: BN
  bump: number
  vaultBump: number
}

export interface PlayerAccount {
  game: PublicKey
  wallet: PublicKey
  index: number
  priceAtReceive: BN
  bump: number
}
