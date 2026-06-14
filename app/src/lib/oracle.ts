import { PublicKey } from "@solana/web3.js"

export const ORACLE_SOL_USD = new PublicKey("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu")
const PRICE_OFFSET = 73

export function parseOraclePrice(data: Buffer | Uint8Array): number {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)
  const dv  = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const raw = dv.getBigInt64(PRICE_OFFSET, true)
  return Number(raw) * Math.pow(10, -8)
}
