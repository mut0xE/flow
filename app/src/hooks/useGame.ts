"use client"
import { useEffect, useRef, useState } from "react"
import { type Address } from "@solana/kit"
import { fetchMaybeGameState } from "@/generated/accounts/gameState"
import { l1Rpc, getErRpc } from "@/lib/rpc"
import { GameState } from "@/types/game"
import { GameStatus } from "@/generated/types/gameStatus"

async function fetchGameFromAny(address: Address): Promise<GameState | null> {
  const [l1Acc, erAcc] = await Promise.all([
    fetchMaybeGameState(l1Rpc, address).catch(() => null),
    fetchMaybeGameState(getErRpc(), address).catch(() => null),
  ])

  const erData = erAcc?.exists ? erAcc.data : null
  const l1Data = l1Acc?.exists ? l1Acc.data : null

  // Settled is final — prefer from either source first
  if (l1Data?.status === GameStatus.Settled) return l1Data
  if (erData?.status === GameStatus.Settled) return erData
  // ER is authoritative for active/ended state (live game)
  if (erData && (erData.status === GameStatus.Active || erData.status === GameStatus.Ended)) return erData
  // L1 fallback — but skip Waiting when there's no ER data at all (game is mid-commit,
  // L1 still shows pre-delegation Waiting state while ER account is being undelegated)
  if (l1Data && l1Data.status !== GameStatus.Waiting) return l1Data
  if (l1Data) return l1Data
  if (erData) return erData
  return null
}

export function useGame(address: Address | null): { game: GameState | null; loading: boolean; refetch: () => void } {
  const [game, setGame] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const hasDataRef = useRef(false)

  useEffect(() => {
    if (!address) return
    hasDataRef.current = false
    let cancelled = false

    async function fetchGame() {
      const data = await fetchGameFromAny(address!)
      if (!cancelled) {
        setGame(prev => {
          // Never downgrade from Ended/Settled to Waiting (ER→L1 commit propagation window)
          if (
            prev != null &&
            data != null &&
            (prev.status === GameStatus.Settled || prev.status === GameStatus.Ended) &&
            data.status === GameStatus.Waiting
          ) {
            return prev
          }
          return data
        })
        setLoading(false)
        hasDataRef.current = true
      }
    }

    if (!hasDataRef.current) setLoading(true)
    fetchGame()
    const id = setInterval(fetchGame, 1_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [address, tick])

  const refetch = () => setTick(t => t + 1)

  return { game, loading, refetch }
}
