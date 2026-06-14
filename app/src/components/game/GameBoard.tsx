"use client"
import { useEffect, useState, useRef } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { AnchorProvider } from "@coral-xyz/anchor"
import { PublicKey } from "@solana/web3.js"
import { GameState } from "@/types/game"
import { ScoreDisplay } from "./ScoreDisplay"
import { PassButton } from "./PassButton"
import { PriceChart } from "@/components/price/PriceChart"
import { useOraclePrice } from "@/hooks/useOraclePrice"
import { useSession } from "@/hooks/useSession"
import { l1Connection, getErConnection } from "@/lib/connections"
import { getProgram, PROGRAM_ID } from "@/lib/anchor"
import { getPlayerPDA, getVaultPDA } from "@/lib/pdas"
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk"
import { Transaction, SystemProgram } from "@solana/web3.js"
import { calcScorePreview } from "@/lib/scores"
import { ORACLE_SOL_USD } from "@/lib/oracle"

interface Props {
  game: GameState
  gamePDA: PublicKey
  settleOnly?: boolean
}

function statusLabel(status: GameState["status"]): { label: string; color: string } {
  if ("waiting" in status) return { label: "WAITING", color: "text-yellow-400" }
  if ("active" in status) return { label: "ACTIVE", color: "text-green-400" }
  if ("ended" in status) return { label: "ENDED", color: "text-red-400" }
  return { label: "SETTLED", color: "text-gray-400" }
}

function timeRemaining(endsAt: number): string {
  const now = Math.floor(Date.now() / 1000)
  const diff = endsAt - now
  if (diff <= 0) return "Ended"
  const m = Math.floor(diff / 60)
  const s = diff % 60
  return `${m}m ${s}s`
}

export function GameBoard({ game, gamePDA, settleOnly }: Props) {
  const { publicKey, signTransaction } = useWallet()
  const price = useOraclePrice()
  const [settling, setSettling] = useState(false)
  const [settleError, setSettleError] = useState<string | null>(null)
  const [timeLeft, setTimeLeft] = useState("")
  // Live unrealized score for the current holder (micro-bp)
  const [holderPriceAtReceive, setHolderPriceAtReceive] = useState<number | null>(null)
  const holderKeyRef = useRef<string>("")

  const provider = publicKey && signTransaction
    ? new AnchorProvider(
        l1Connection,
        { publicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
        { commitment: "confirmed" }
      )
    : null

  const { tempKeypairRef, sessionTokenPDARef, sessionExists, isExpired, createSession } = useSession(
    publicKey ?? null,
    provider,
    signTransaction as any
  )

  useEffect(() => {
    const id = setInterval(() => setTimeLeft(timeRemaining(game.endsAt.toNumber())), 1000)
    setTimeLeft(timeRemaining(game.endsAt.toNumber()))
    return () => clearInterval(id)
  }, [game.endsAt])

  // Fetch holder's price_at_receive from ER PlayerAccount (re-fetch on holder change)
  useEffect(() => {
    if (!("active" in game.status)) return
    const holderKey = game.currentHolder.toBase58()
    if (holderKeyRef.current === holderKey) return
    holderKeyRef.current = holderKey
    const [holderPDA] = getPlayerPDA(gamePDA, game.currentHolder)
    const erConn = getErConnection()
    const erProgram = getProgram(new AnchorProvider(erConn, {} as any, { commitment: "confirmed" }))
    ;(erProgram.account as any).playerAccount.fetch(holderPDA)
      .then((acc: any) => setHolderPriceAtReceive(acc.priceAtReceive.toNumber()))
      .catch(() => {})
  }, [game.currentHolder.toBase58(), game.status])

  const { label, color } = statusLabel(game.status)
  const direction = "long" in game.direction ? "LONG" : "SHORT"
  const dirColor = direction === "LONG" ? "text-green-400" : "text-red-400"
  // Treat as ended if on-chain status is Ended OR timer has expired (crank may lag)
  const timerExpired = game.endsAt.toNumber() <= Math.floor(Date.now() / 1000)
  const isEnded = "ended" in game.status || timerExpired
  const isActive = "active" in game.status && !timerExpired
  const isCreator = publicKey && game.creator.toBase58() === publicKey.toBase58()

  // Live unrealized P&L for the current holder using sol_price_now (updated by crank every 100ms)
  const solPriceNow = game.solPriceNow?.toNumber() ?? 0
  const liveScoreBp = isActive && holderPriceAtReceive && solPriceNow
    ? calcScorePreview(
        "long" in game.direction ? "long" : "short",
        holderPriceAtReceive,
        solPriceNow
      )
    : null

  const handleCommitAndSettle = async () => {
    if (!publicKey || !signTransaction) return
    setSettling(true)
    setSettleError(null)
    try {
      const erConn = getErConnection()
      const sessionKp = tempKeypairRef.current
      const signerKey = sessionKp ? sessionKp.publicKey : publicKey

      // Check if the game account is owned by the Flow program (undelegated).
      // MagicBlock syncs state to L1 periodically while still delegated, so
      // "ended" in game.status on L1 does NOT mean commitAndSettle has run.
      const gameAccountInfo = await l1Connection.getAccountInfo(gamePDA)
      const alreadyCommitted = !!gameAccountInfo?.owner.equals(PROGRAM_ID) && "ended" in game.status

      if (!alreadyCommitted) {
        const erProgram = getProgram(new AnchorProvider(erConn, {} as any, { commitment: "confirmed" }))

        // Poll ER until game status is Ended (crank may lag behind timer expiry)
        const deadline = Date.now() + 60_000
        let erGame: any = null
        while (Date.now() < deadline) {
          try { erGame = await (erProgram.account as any).gameState.fetch(gamePDA) } catch { /* retry */ }
          if (erGame && "ended" in erGame.status) break
          setSettleError("Waiting for game to end on ER…")
          await new Promise(r => setTimeout(r, 2000))
        }
        if (!erGame || !("ended" in erGame.status)) {
          throw new Error("Game has not ended on ER yet — try again in a moment")
        }
        setSettleError(null)

        // Build commit_and_settle Anchor instruction — finalizes last holder score + commit+undelegate
        const playerRemainingAccounts = game.players.map(p => ({
          pubkey: getPlayerPDA(gamePDA, p)[0], isSigner: false, isWritable: true
        }))
        const commitIx = await (erProgram.methods as any)
          .commitAndSettle()
          .accounts({ signer: signerKey, game: gamePDA, priceFeed: ORACLE_SOL_USD, systemProgram: SystemProgram.programId })
          .remainingAccounts(playerRemainingAccounts)
          .instruction()

        const tx = new Transaction().add(commitIx)
        const { value: { blockhash, lastValidBlockHeight } } = await erConn.getLatestBlockhashAndContext()
        tx.recentBlockhash = blockhash
        tx.feePayer = signerKey

        let erSig: string
        if (sessionKp) {
          tx.sign(sessionKp)
          erSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true })
        } else {
          const signed = await signTransaction(tx)
          erSig = await erConn.sendRawTransaction(signed.serialize(), { skipPreflight: true })
        }
        await erConn.confirmTransaction({ blockhash, lastValidBlockHeight, signature: erSig }, "confirmed")

        // Verify the tx succeeded (skipPreflight means a failed tx still gets "confirmed")
        const txInfo = await erConn.getTransaction(erSig, { maxSupportedTransactionVersion: 0 })
        if (txInfo?.meta?.err) {
          throw new Error("commitAndSettle failed on ER: " + JSON.stringify(txInfo.meta.err))
        }

        // Wait for L1 commit to actually land before calling settle()
        await GetCommitmentSignature(erSig, erConn)
      }

      const l1Provider = new AnchorProvider(
        l1Connection,
        { publicKey, signTransaction: signTransaction as any, signAllTransactions: undefined as any },
        { commitment: "confirmed" }
      )
      const l1Program = getProgram(l1Provider)
      const [vaultPDA] = getVaultPDA(gamePDA)

      const remainingAccounts = game.players.map(w => ({
        pubkey: w, isSigner: false, isWritable: true
      }))

      await (l1Program.methods as any).settle()
        .accounts({ game: gamePDA, vault: vaultPDA, caller: publicKey })
        .remainingAccounts(remainingAccounts)
        .rpc()
    } catch (e: any) {
      setSettleError(e?.message ?? "Settlement failed")
    } finally {
      setSettling(false)
    }
  }

  if (settleOnly) {
    return (
      <div className="space-y-2">
        {settleError && <div className="text-red-400 text-xs">{settleError}</div>}
        <button
          onClick={handleCommitAndSettle}
          disabled={settling}
          className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded"
        >
          {settling ? "Settling..." : "Commit & Settle"}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border ${isEnded ? "text-red-400 border-red-800" : color} border-current`}>
            {isEnded ? "ENDED" : label}
          </span>
          <span className={`text-sm font-bold ${dirColor}`}>{direction}</span>
        </div>
        <div className="text-sm text-gray-400 font-mono">{timeLeft}</div>
      </div>

      {/* Price */}
      <div className="text-center">
        <div className="text-xs text-gray-500 mb-1">SOL/USD</div>
        <div className="text-3xl font-mono font-bold text-white">
          {price !== null ? `$${price.toFixed(4)}` : "—"}
        </div>
        {game.startPrice.toNumber() > 0 && (
          <div className="text-xs text-gray-500 mt-1">
            Start: ${(game.startPrice.toNumber() * 1e-8).toFixed(4)}
          </div>
        )}
      </div>

      {/* Chart */}
      <PriceChart price={price} startPrice={game.startPrice.toNumber() > 0 ? game.startPrice.toNumber() * 1e-8 : null} />

      {/* Scores */}
      <ScoreDisplay game={game} currentWallet={publicKey} liveScoreBp={liveScoreBp} holderWallet={game.currentHolder} />

      {/* Session — created at join/create time; only show renew if expired */}
      {isActive && (
        <div className="border border-gray-800 rounded p-3 space-y-2">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Session Key</div>
          {isExpired ? (
            <button
              onClick={createSession}
              className="w-full py-2 bg-blue-800 hover:bg-blue-700 text-white text-sm rounded"
            >
              Renew Session
            </button>
          ) : sessionExists ? (
            <div className="text-xs text-green-400">Session active</div>
          ) : (
            <div className="text-xs text-gray-500">Session created at game join</div>
          )}
        </div>
      )}

      {/* Pass */}
      {isActive && sessionExists && !isExpired && (
        <PassButton
          game={game}
          gamePDA={gamePDA}
          tempKeypair={tempKeypairRef.current}
          sessionTokenPDA={sessionTokenPDARef.current}
        />
      )}

      {/* Commit & Settle */}
      {isEnded && isCreator && (
        <div className="space-y-2">
          {settleError && <div className="text-red-400 text-xs">{settleError}</div>}
          <button
            onClick={handleCommitAndSettle}
            disabled={settling}
            className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold rounded"
          >
            {settling ? "Settling..." : "Commit & Settle"}
          </button>
        </div>
      )}

      {"settled" in game.status && (
        <div className="text-center text-green-400 font-bold py-4 border border-green-800 rounded">
          Game Settled — Payouts Distributed
        </div>
      )}
    </div>
  )
}
