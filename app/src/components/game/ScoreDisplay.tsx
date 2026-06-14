"use client"
import { PublicKey } from "@solana/web3.js"
import { GameState } from "@/types/game"
import { bpToPercent, scoreColor } from "@/lib/scores"

interface Props {
  game: GameState
  currentWallet?: PublicKey | null
  // Live unrealized score for the current holder (micro-bp, null = not yet loaded)
  liveScoreBp?: number | null
  holderWallet?: PublicKey | null
}

export function ScoreDisplay({ game, currentWallet, liveScoreBp, holderWallet }: Props) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Scores</div>
      {game.players.map((player, i) => {
        const score = game.scores[i]?.toNumber() ?? 0
        const isHolder = holderWallet
          ? player.toBase58() === holderWallet.toBase58()
          : player.toBase58() === game.currentHolder.toBase58()
        const isMe = currentWallet && player.toBase58() === currentWallet.toBase58()
        // Show live unrealized P&L for the current holder
        const showLive = isHolder && liveScoreBp !== null && liveScoreBp !== undefined
        const displayScore = showLive ? score + liveScoreBp! : score
        return (
          <div key={player.toBase58()} className={`flex items-center justify-between px-3 py-2 rounded ${isHolder ? "bg-amber-900/20 border border-amber-700/40" : "bg-gray-900"}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-400">
                {player.toBase58().slice(0, 4)}…{player.toBase58().slice(-4)}
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
        )
      })}
    </div>
  )
}
