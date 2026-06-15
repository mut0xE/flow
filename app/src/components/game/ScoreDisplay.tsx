"use client"
import { PublicKey } from "@solana/web3.js"
import { GameState } from "@/types/game"
import { bpToPercent, scoreColor } from "@/lib/scores"

interface Props {
  game: GameState
  currentWallet?: PublicKey | null
  liveScoreBp?: number | null
  holderWallet?: PublicKey | null
  // wallet pubkey → Pyth raw price (×1e8) when they last received the position
  playerEntryPrices?: Record<string, number>
}

export function ScoreDisplay({ game, currentWallet, liveScoreBp, holderWallet, playerEntryPrices }: Props) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Scores</div>
      {game.players.map((player, i) => {
        const key = player.toBase58()
        const score = game.scores[i]?.toNumber() ?? 0
        const isHolder = holderWallet
          ? key === holderWallet.toBase58()
          : key === game.currentHolder.toBase58()
        const isMe = currentWallet && key === currentWallet.toBase58()
        const showLive = isHolder && liveScoreBp !== null && liveScoreBp !== undefined
        const displayScore = showLive ? score + liveScoreBp! : score
        const entryPrice = playerEntryPrices?.[key]
        const entryUsd = entryPrice != null && entryPrice > 0
          ? `$${(entryPrice * 1e-8).toFixed(4)}`
          : null
        return (
          <div key={key} className={`px-3 py-2 rounded ${isHolder ? "bg-amber-900/20 border border-amber-700/40" : "bg-gray-900"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-gray-400">
                  {key.slice(0, 4)}…{key.slice(-4)}
                </span>
                {isMe && <span className="text-xs text-blue-400">(you)</span>}
                {isHolder && <span className="text-xs text-amber-400">🥔</span>}
              </div>
              <div className="text-right">
                <span className={`text-sm font-mono font-bold ${scoreColor(displayScore)}`}>
                  {displayScore >= 0 ? "+" : ""}{bpToPercent(displayScore)}
                </span>
                {showLive && (
                  <div className="text-xs text-amber-600">live</div>
                )}
              </div>
            </div>
            {entryUsd && (
              <div className="mt-1 text-xs text-gray-500 font-mono">
                entry <span className="text-gray-300">{entryUsd}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
