"use client"
import { useCallback, useState } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { AnchorProvider, BN } from "@coral-xyz/anchor"
import { LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js"
import { useForm } from "react-hook-form"
import { useRouter } from "next/navigation"
import { l1Connection } from "@/lib/connections"
import { getProgram } from "@/lib/anchor"
import { getGamePDA, getVaultPDA, getPlayerPDA } from "@/lib/pdas"
import {
  getSessionIdentity,
  buildCreateSessionIx,
} from "@/lib/session"

function parseError(e: any): string {
  if (e?.error?.errorMessage) return e.error.errorMessage
  const logs: string[] =
    e?.logs ?? (typeof e?.getLogs === "function" ? e.getLogs() : []) ?? []
  for (const log of logs) {
    const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/)
    if (anchor) return anchor[1].trim()
    const msg = log.match(/Error Message: (.+)/)
    if (msg) return msg[1].trim()
    const transfer = log.match(/Transfer: (.+)/)
    if (transfer) return transfer[1].trim()
  }
  const raw: string = e?.message ?? String(e)
  const simMatch = raw.match(/Transaction simulation failed: (.+?)(?:\. Logs:|$)/)
  if (simMatch) return simMatch[1].trim()
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw
}

const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`

interface FormValues {
  direction: "long" | "short"
  entryFeeSol: string
  lossLimit: string
  maxPlayers: string
  durationMinutes: string
}

export function CreateGameForm() {
  const { publicKey, signTransaction, signAllTransactions } = useWallet()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [txSig, setTxSig] = useState<string | null>(null)

  const { register, handleSubmit, watch, setValue } = useForm<FormValues>({
    defaultValues: {
      direction: "long",
      entryFeeSol: "0.01",
      lossLimit: "5",
      maxPlayers: "2",
      durationMinutes: "10",
    }
  })

  const direction = watch("direction")

  const onSubmit = useCallback(async (values: FormValues) => {
    if (!publicKey || !signTransaction || !signAllTransactions) return
    setLoading(true)
    setError(null)
    setTxSig(null)
    try {
      const provider = new AnchorProvider(
        l1Connection,
        { publicKey, signTransaction: signTransaction as any, signAllTransactions: signAllTransactions as any },
        { commitment: "confirmed" }
      )
      const program = getProgram(provider)

      const gameId = new BN(Math.floor(Math.random() * 2 ** 32))
      const entryFee = new BN(Math.round(parseFloat(values.entryFeeSol) * LAMPORTS_PER_SOL))
      const lossLimit = parseInt(values.lossLimit)
      const maxPlayers = parseInt(values.maxPlayers)
      const durationSecs = parseInt(values.durationMinutes) * 60
      const endsAt = new BN(Math.floor(Date.now() / 1000) + durationSecs)
      const dirArg = values.direction === "long" ? { long: {} } : { short: {} }

      const [gamePDA] = getGamePDA(gameId, publicKey)
      const [vaultPDA] = getVaultPDA(gamePDA)
      const [creatorPlayerPDA] = getPlayerPDA(gamePDA, publicKey)

      const { sessionKp, exists: existingSession } = await getSessionIdentity(publicKey, l1Connection)

      // Build create_game ix
      const createGameIx = await (program.methods as any)
        .createGame(gameId, dirArg, entryFee, lossLimit, maxPlayers, endsAt)
        .accounts({
          game: gamePDA,
          vault: vaultPDA,
          player: creatorPlayerPDA,
          creator: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction()

      const tx = new Transaction().add(createGameIx)

      // Bundle session creation into same tx if session doesn't exist
      let sig: string
      if (!existingSession) {
        const sessionValidUntil = new BN(Math.floor(Date.now() / 1000) + 6 * 24 * 3600)
        const sessionIx = await buildCreateSessionIx(publicKey, signTransaction as any, sessionKp, sessionValidUntil)
        tx.add(sessionIx)
        const { blockhash, lastValidBlockHeight } = await l1Connection.getLatestBlockhash("confirmed")
        tx.recentBlockhash = blockhash
        tx.feePayer = publicKey
        tx.partialSign(sessionKp)
        const signed = await signTransaction(tx)
        sig = await l1Connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
        await l1Connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed")
      } else {
        const { blockhash, lastValidBlockHeight } = await l1Connection.getLatestBlockhash("confirmed")
        tx.recentBlockhash = blockhash
        tx.feePayer = publicKey
        const signed = await signTransaction(tx)
        sig = await l1Connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
        await l1Connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig }, "confirmed")
      }
      setTxSig(sig)

      router.push(`/game/${gamePDA.toBase58()}`)
    } catch (e: any) {
      setError(parseError(e))
    } finally {
      setLoading(false)
    }
  }, [publicKey, signTransaction, signAllTransactions, router])

  if (!publicKey) {
    return <div className="text-gray-400 text-sm">Connect wallet to create a game.</div>
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      {/* Direction */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Direction</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setValue("direction", "long")}
            className={`flex-1 py-2 rounded font-bold text-sm border transition-colors ${direction === "long" ? "bg-green-700 border-green-500 text-white" : "bg-gray-900 border-gray-700 text-gray-400"}`}>
            LONG
          </button>
          <button type="button" onClick={() => setValue("direction", "short")}
            className={`flex-1 py-2 rounded font-bold text-sm border transition-colors ${direction === "short" ? "bg-red-700 border-red-500 text-white" : "bg-gray-900 border-gray-700 text-gray-400"}`}>
            SHORT
          </button>
        </div>
      </div>

      {/* Entry fee */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Entry Fee (SOL)</label>
        <input {...register("entryFeeSol")} type="number" step="0.001" min="0.001"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:border-green-500 outline-none" />
      </div>

      {/* Loss limit */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Loss Limit (%)</label>
        <input {...register("lossLimit")} type="number" min="1" max="50"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:border-green-500 outline-none" />
      </div>

      {/* Max players */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Max Players</label>
        <input {...register("maxPlayers")} type="number" min="2" max="8"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:border-green-500 outline-none" />
      </div>

      {/* Duration */}
      <div>
        <label className="text-xs text-gray-500 uppercase tracking-wider block mb-2">Duration (minutes)</label>
        <input {...register("durationMinutes")} type="number" min="1" max="60"
          className="w-full bg-gray-900 border border-gray-700 rounded px-3 py-2 text-white font-mono focus:border-green-500 outline-none" />
      </div>

      <div className="text-xs text-gray-600">Session key created in same tx — no extra popups needed.</div>

      {error && (
        <div className="flex items-start gap-2 text-sm bg-red-950/40 border border-red-800 rounded px-3 py-2">
          <span className="text-red-400 mt-0.5 shrink-0">✕</span>
          <span className="text-red-300">{error}</span>
        </div>
      )}
      {txSig && (
        <a
          href={EXPLORER(txSig)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs font-mono text-blue-400 underline hover:text-blue-300 text-center"
        >
          ↗ View transaction: {txSig.slice(0, 8)}…{txSig.slice(-8)}
        </a>
      )}

      <button type="submit" disabled={loading}
        className="w-full py-3 bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded transition-colors">
        {loading ? "Creating..." : "Create Game"}
      </button>
    </form>
  )
}
