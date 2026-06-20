import { createSolanaRpc } from "@solana/kit"
import { L1_RPC, ER_RPC } from "./connections"

export const l1Rpc = createSolanaRpc(L1_RPC)

let _erRpc: ReturnType<typeof createSolanaRpc> | null = null
export function getErRpc() {
  if (!_erRpc) _erRpc = createSolanaRpc(ER_RPC)
  return _erRpc
}
