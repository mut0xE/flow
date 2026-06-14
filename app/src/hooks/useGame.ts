"use client"
import { useEffect, useState } from "react"
import { PublicKey } from "@solana/web3.js"
import { AnchorProvider } from "@coral-xyz/anchor"
import { l1Connection, getErConnection } from "@/lib/connections"
import { getProgram } from "@/lib/anchor"
import { GameState } from "@/types/game"

// Singletons — Program constructor is expensive (builds codecs synchronously)
let _l1Program: ReturnType<typeof getProgram> | null = null
function getL1Program() {
  if (!_l1Program) {
    const provider = new AnchorProvider(l1Connection, {} as any, { commitment: "confirmed" })
    _l1Program = getProgram(provider)
  }
  return _l1Program
}
let _erProgram: ReturnType<typeof getProgram> | null = null
function getErProgram() {
  if (!_erProgram) {
    const provider = new AnchorProvider(getErConnection(), {} as any, { commitment: "confirmed" })
    _erProgram = getProgram(provider)
  }
  return _erProgram
}

// Games in Waiting/Settled state live on L1.
// Games in Active/Ended state are delegated to ER.
// We try L1 first; if missing or delegated away, fall back to ER.
async function fetchGameFromAny(gamePDA: PublicKey): Promise<GameState | null> {
  const tryFetch = async (getP: () => ReturnType<typeof getProgram>) => {
    try {
      const program = getP()
      return (await (program.account as any).gameState.fetch(gamePDA)) as GameState
    } catch {
      return null
    }
  }

  const [l1Data, erData] = await Promise.all([tryFetch(getL1Program), tryFetch(getErProgram)])

  // Prefer ER data when the game is active/ended there; otherwise use L1
  if (erData && ("active" in erData.status || "ended" in erData.status)) return erData
  if (l1Data) return l1Data
  if (erData) return erData
  return null
}

export function useGame(gamePDA: PublicKey | null): { game: GameState | null; loading: boolean } {
  const [game, setGame] = useState<GameState | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!gamePDA) return
    let cancelled = false

    async function fetchGame() {
      const data = await fetchGameFromAny(gamePDA!)
      if (!cancelled) {
        setGame(data)
        setLoading(false)
      }
    }

    setLoading(true)
    fetchGame()
    const id = setInterval(fetchGame, 1_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [gamePDA?.toBase58()])

  return { game, loading }
}
