// Scores are stored in micro-bp: 1_000_000 × fractional_change
// 1% move → 10_000 micro-bp; divide by 10_000 to get %
export function bpToPercent(microBp: number): string {
  return (microBp / 10_000).toFixed(4) + "%"
}

export function scoreColor(microBp: number): string {
  return microBp > 0 ? "text-green-400" : microBp < 0 ? "text-red-400" : "text-gray-400"
}

// Returns micro-bp to match on-chain score units
export function calcScorePreview(
  direction: "long" | "short",
  priceAtReceive: number,
  priceNow: number
): number {
  if (priceAtReceive === 0) return 0
  if (direction === "long") {
    return Math.round(((priceNow - priceAtReceive) * 1_000_000) / priceAtReceive)
  } else {
    return Math.round(((priceAtReceive - priceNow) * 1_000_000) / priceAtReceive)
  }
}

export function rawBpToDisplay(raw: number): string {
  return bpToPercent(raw)
}
