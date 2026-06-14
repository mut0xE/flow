import { Connection } from "@solana/web3.js"

export const L1_RPC = process.env.NEXT_PUBLIC_HELIUS_RPC || "https://api.devnet.solana.com"
export const ER_RPC = "https://devnet.magicblock.app"
export const ER_WS  = "wss://devnet.magicblock.app"

// l1Connection: HTTP-only, safe to create at module level (including SSR).
export const l1Connection = new Connection(L1_RPC, "confirmed")

// erConnection: has a wsEndpoint, so @solana/web3.js immediately opens an
// RpcWebSocketClient in the constructor. In Next.js SSR (Node.js) this hangs
// the process. Create lazily — only when first accessed on the client.
let _erConnection: Connection | null = null
export function getErConnection(): Connection {
  if (!_erConnection) {
    _erConnection = new Connection(ER_RPC, { wsEndpoint: ER_WS, commitment: "confirmed" })
  }
  return _erConnection
}

