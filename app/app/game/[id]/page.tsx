"use client";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { MAGIC_PROGRAM_ID, GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { useGame } from "@/hooks/useGame";
import { GameBoard } from "@/components/game/GameBoard";
import { l1Connection, getErConnection, ER_RPC } from "@/lib/connections";
import { getProgram, PROGRAM_ID } from "@/lib/anchor";
import { getPlayerPDA, getVaultPDA } from "@/lib/pdas";
import { ORACLE_SOL_USD } from "@/lib/oracle";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import {
  buildCreateSessionIx,
  getSessionIdentity,
} from "@/lib/session";

async function fetchErValidator(): Promise<PublicKey> {
  const res = await fetch(ER_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getIdentity",
      params: [],
    }),
  });
  const data = await res.json();
  return new PublicKey(data.result.identity);
}

const ROUTER_URL = "https://devnet-router.magicblock.app/";

async function getDelegationStatus(pubkey: PublicKey): Promise<boolean> {
  try {
    const res = await fetch(ROUTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getDelegationStatus",
        params: [pubkey.toBase58()],
      }),
    });
    const data = await res.json();
    return data?.result?.isDelegated === true;
  } catch {
    return false;
  }
}

// Poll router until all pubkeys show isDelegated:true or timeout (30s)
async function pollUntilDelegated(
  pubkeys: PublicKey[],
  onProgress: (msg: string) => void,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statuses = await Promise.all(pubkeys.map(getDelegationStatus));
    const pending = pubkeys.filter((_, i) => !statuses[i]);
    if (pending.length === 0) return;
    onProgress(
      `Waiting for ER propagation… (${statuses.filter(Boolean).length}/${
        pubkeys.length
      } delegated)`
    );
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(
    "Timed out waiting for delegation to propagate to ER. Try again."
  );
}

const EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function sendL1SkipPreflight(
  tx: Transaction,
  feePayer: PublicKey,
  signTransaction: (tx: any) => Promise<any>
): Promise<string> {
  const { blockhash, lastValidBlockHeight } =
    await l1Connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  const signed = await signTransaction(tx);
  const sig = await l1Connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  await l1Connection.confirmTransaction(
    { blockhash, lastValidBlockHeight, signature: sig },
    "confirmed"
  );
  return sig;
}

export default function GamePage() {
  const params = useParams();
  const id = params?.id as string;
  const gamePDA = useMemo(() => {
    try {
      return new PublicKey(id);
    } catch {
      return null;
    }
  }, [id]);
  const { game, loading, refetch } = useGame(gamePDA);
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinSig, setJoinSig] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startStatus, setStartStatus] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [txLinks, setTxLinks] = useState<{ label: string; sig: string }[]>([]);
  const [delegationStatus, setDelegationStatus] = useState<
    { label: string; delegated: boolean }[] | null
  >(null);
  const [copied, setCopied] = useState(false);
  // Settle state — lives here so it survives the Active→Ended layout switch
  const [settling, setSettling] = useState(false);
  const [settleProgress, setSettleProgress] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleSig, setSettleSig] = useState<string | null>(null);

  if (!gamePDA)
    return <div className="text-red-400">Invalid game address.</div>;
  if (loading && !game) return <div className="text-gray-500">Loading...</div>;
  if (!game) return <div className="text-gray-500">Game not found.</div>;

  const isPlayer =
    publicKey &&
    game.players.some((p) => p.toBase58() === publicKey.toBase58());
  const isCreator =
    publicKey && game.creator.toBase58() === publicKey.toBase58();
  const isWaiting = "waiting" in game.status;
  const isActive = "active" in game.status;
  const isEnded = "ended" in game.status;
  const isSettled = "settled" in game.status;
  const timerExpired = game.endsAt.toNumber() <= Math.floor(Date.now() / 1000);
  // Treat as ended if on-chain says ended OR timer has expired (crank may lag)
  const isEffectivelyEnded = isEnded || timerExpired;
  const isFull = game.playerCount >= game.maxPlayers;
  const feeSol = game.entryFee.toNumber() / LAMPORTS_PER_SOL;

  // join_game + createSessionV2 in one tx — one popup for the player
  const handleJoin = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions || !gamePDA)
      return;
    setJoining(true);
    setJoinError(null);
    setJoinSig(null);
    try {
      const provider = new AnchorProvider(
        l1Connection,
        {
          publicKey,
          signTransaction: signTransaction as any,
          signAllTransactions: signAllTransactions as any,
        },
        { commitment: "confirmed" }
      );
      const program = getProgram(provider);
      const [playerPDA] = getPlayerPDA(gamePDA, publicKey);
      const [vaultPDA] = getVaultPDA(gamePDA);

      const joinIx = await (program.methods as any)
        .joinGame()
        .accounts({
          game: gamePDA,
          vault: vaultPDA,
          playerAccount: playerPDA,
          player: publicKey,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(joinIx);

      // Bundle session creation into same tx, skipping stale wrong-owner tokens.
      const { sessionKp, exists: existingSession } = await getSessionIdentity(publicKey, l1Connection);

      let sig: string;
      if (!existingSession) {
        const validUntil = new BN(
          Math.floor(Date.now() / 1000) + 1 * 24 * 3600
        );
        const sessionIx = await buildCreateSessionIx(
          publicKey,
          signTransaction as any,
          sessionKp,
          validUntil
        );
        tx.add(sessionIx);
        const { blockhash, lastValidBlockHeight } =
          await l1Connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        tx.partialSign(sessionKp);
        const signed = await signTransaction(tx);
        sig = await l1Connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
        });
        await l1Connection.confirmTransaction(
          { blockhash, lastValidBlockHeight, signature: sig },
          "confirmed"
        );
      } else {
        sig = await sendL1SkipPreflight(tx, publicKey, signTransaction as any);
      }
      setJoinSig(sig);
    } catch (e: any) {
      setJoinError(parseJoinError(e));
    } finally {
      setJoining(false);
    }
  };

  function parseJoinError(e: any): string {
    if (e?.error?.errorMessage) return e.error.errorMessage;
    const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
    for (const log of logs) {
      const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/);
      if (anchor) return anchor[1].trim();
      const msg = log.match(/Error Message: (.+)/);
      if (msg) return msg[1].trim();
      const custom = log.match(/Program log: ([A-Z][a-zA-Z]+Error[^\n]*)/);
      if (custom) return custom[1].trim();
    }
    const raw: string = e?.message ?? String(e) ?? "Join failed";
    return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
  }

  // Extract a readable error from a Solana/Anchor exception
  function parseStartError(e: any): string {
    // Anchor decoded error
    if (e?.error?.errorMessage) return e.error.errorMessage;
    // Parse program logs — most reliable source of truth
    const logs: string[] = e?.logs ?? e?.transactionLogs ?? [];
    for (const log of logs) {
      const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/);
      if (anchor) return anchor[1].trim();
      const msg = log.match(/Error Message: (.+)/);
      if (msg) return msg[1].trim();
      const custom = log.match(/Program log: ([A-Z][a-zA-Z]+Error[^\n]*)/);
      if (custom) return custom[1].trim();
    }
    const raw: string = e?.message ?? String(e) ?? "Unknown error";
    // Shorten enormous base58-encoded simulation blobs
    return raw.length > 180 ? raw.slice(0, 180) + "…" : raw;
  }

  const handleCheckDelegation = async () => {
    if (!gamePDA || !game) return;
    const pdas = [
      ...game.players.map((w: PublicKey) => ({
        label: `Player ${w.toBase58().slice(0, 4)}…`,
        pda: getPlayerPDA(gamePDA, w)[0],
      })),
      { label: "Game PDA", pda: gamePDA },
    ];
    const statuses = await Promise.all(
      pdas.map(async ({ label, pda }) => ({
        label,
        delegated: await getDelegationStatus(pda),
      }))
    );
    setDelegationStatus(statuses);
  };

  // Delegate all 3 PDAs in one tx, then start_game + schedule_tick via session key (no popups)
  // Only the creator can call this — start_game validates game.creator == signer
  const handleDelegateAndStart = async () => {
    if (
      !publicKey ||
      !signTransaction ||
      !signAllTransactions ||
      !isCreator ||
      !gamePDA
    )
      return;
    setStarting(true);
    setStartError(null);
    setTxLinks([]);
    setDelegationStatus(null);

    try {
      // ── Step 1: session key ──────────────────────────────────────────────────
      setStartStatus("Checking session key...");
      const {
        sessionKp,
        sessionPDA,
        exists: existingSession,
      } = await getSessionIdentity(publicKey, l1Connection);
      if (!existingSession) {
        setStartStatus("Creating session key… (approve wallet popup)");
        const validUntil = new BN(
          Math.floor(Date.now() / 1000) + 1 * 24 * 3600
        );
        const sessionIx = await buildCreateSessionIx(
          publicKey,
          signTransaction as any,
          sessionKp,
          validUntil
        );
        const sessionTx = new Transaction().add(sessionIx);
        const { blockhash: sBh, lastValidBlockHeight: sLvbh } =
          await l1Connection.getLatestBlockhash("confirmed");
        sessionTx.recentBlockhash = sBh;
        sessionTx.feePayer = publicKey;
        sessionTx.partialSign(sessionKp);
        const signedSessionTx = await signTransaction(sessionTx);
        const sessionSig = await l1Connection.sendRawTransaction(
          signedSessionTx.serialize(),
          { skipPreflight: false }
        );
        await l1Connection.confirmTransaction(
          {
            blockhash: sBh,
            lastValidBlockHeight: sLvbh,
            signature: sessionSig,
          },
          "confirmed"
        );
        setTxLinks((prev) => [
          ...prev,
          { label: "Session Key", sig: sessionSig },
        ]);
      } else {
        setStartStatus("Session key already exists — skipping.");
      }

      // ── Step 2: delegation — check ALL accounts via router, not just game ──────
      const erConn = getErConnection();
      const erProvider = new AnchorProvider(erConn, {} as any, {
        commitment: "confirmed",
      });
      const erProgram = getProgram(erProvider);

      const allPDAs: PublicKey[] = [
        ...game.players.map((w: PublicKey) => getPlayerPDA(gamePDA, w)[0]),
        gamePDA,
      ];

      setStartStatus("Checking delegation status…");
      const delegationStatuses = await Promise.all(
        allPDAs.map(getDelegationStatus)
      );
      const allDelegated = delegationStatuses.every(Boolean);
      const delegatedCount = delegationStatuses.filter(Boolean).length;

      if (allDelegated) {
        setStartStatus(
          `All accounts delegated (${delegatedCount}/${allPDAs.length}) — skipping delegation.`
        );
      } else {
        setStartStatus(
          `Delegating accounts (${delegatedCount}/${allPDAs.length} already delegated)… (approve wallet popup)`
        );
        const validator = await fetchErValidator();
        const l1Provider = new AnchorProvider(
          l1Connection,
          {
            publicKey,
            signTransaction: signTransaction as any,
            signAllTransactions: signAllTransactions as any,
          },
          { commitment: "confirmed" }
        );
        const l1Program = getProgram(l1Provider);
        const delegateTx = new Transaction();
        for (const playerWallet of game.players) {
          const [playerPDA] = getPlayerPDA(gamePDA, playerWallet);
          const ix = await (l1Program.methods as any)
            .delegateAccount({
              playerAccount: { game: gamePDA, player: playerWallet },
            })
            .accounts({ payer: publicKey, pda: playerPDA, validator })
            .instruction();
          delegateTx.add(ix);
        }
        const gameIx = await (l1Program.methods as any)
          .delegateAccount({
            gameState: { gameId: game.gameId, creator: game.creator },
          })
          .accounts({ payer: publicKey, pda: gamePDA, validator })
          .instruction();
        delegateTx.add(gameIx);
        try {
          const delegateSig = await sendL1SkipPreflight(
            delegateTx,
            publicKey,
            signTransaction as any
          );
          setTxLinks((prev) => [
            ...prev,
            { label: "Delegation", sig: delegateSig },
          ]);
        } catch (delegateErr: any) {
          throw new Error("Delegation failed: " + parseStartError(delegateErr));
        }
        // Poll router until all accounts confirm delegated (up to 30s)
        await pollUntilDelegated(allPDAs, setStartStatus);
        setStartStatus(
          `All ${allPDAs.length} accounts confirmed delegated on ER.`
        );
        // Refresh delegation status display
        setDelegationStatus([
          ...game.players.map((w: PublicKey) => ({
            label: `Player ${w.toBase58().slice(0, 4)}…`,
            delegated: true,
          })),
          { label: "Game PDA", delegated: true },
        ]);
      }

      // ── Step 3: start_game (skip if already Active on ER) ───────────────────
      let erGameStatus: string | null = null;
      try {
        const erGame = (await (erProgram.account as any).gameState.fetch(
          gamePDA
        )) as any;
        if ("active" in erGame.status) erGameStatus = "active";
        else if ("ended" in erGame.status) erGameStatus = "ended";
        else if ("settled" in erGame.status) erGameStatus = "settled";
      } catch {
        /* couldn't read — proceed */
      }

      const [creatorPlayerPDA] = getPlayerPDA(gamePDA, publicKey);
      const erProviderSigned = new AnchorProvider(
        erConn,
        {
          publicKey,
          signTransaction: signTransaction as any,
          signAllTransactions: signAllTransactions as any,
        },
        { commitment: "confirmed" }
      );
      const erProgramSigned = getProgram(erProviderSigned);

      if (
        erGameStatus === "active" ||
        erGameStatus === "ended" ||
        erGameStatus === "settled"
      ) {
        setStartStatus(`Game is already ${erGameStatus} — skipping start.`);
      } else {
        setStartStatus("Starting game on ER… (silent, session key)");
        const startGameIx = await (erProgramSigned.methods as any)
          .startGame()
          .accounts({
            signer: sessionKp.publicKey,
            game: gamePDA,
            creatorPlayer: creatorPlayerPDA,
            sessionToken: sessionPDA,
            priceFeed: ORACLE_SOL_USD,
          })
          .instruction();
        const startTx = new Transaction().add(startGameIx);
        const startBh = await erConn.getLatestBlockhash("confirmed");
        startTx.recentBlockhash = startBh.blockhash;
        startTx.feePayer = sessionKp.publicKey;
        startTx.sign(sessionKp);
        try {
          const startSig = await erConn.sendRawTransaction(
            startTx.serialize(),
            { skipPreflight: true }
          );
          await erConn.confirmTransaction(
            {
              blockhash: startBh.blockhash,
              lastValidBlockHeight: startBh.lastValidBlockHeight,
              signature: startSig,
            },
            "confirmed"
          );
          // Verify tx actually succeeded (skipPreflight means failed txs still confirm)
          const startTxInfo = await erConn.getTransaction(startSig, {
            maxSupportedTransactionVersion: 0,
          });
          if (startTxInfo?.meta?.err) {
            throw new Error(
              "start_game tx failed: " +
                JSON.stringify(startTxInfo.meta.err) +
                "\n" +
                (startTxInfo?.meta?.logMessages ?? []).join("\n")
            );
          }
          setTxLinks((prev) => [
            ...prev,
            { label: "Start Game (ER)", sig: startSig },
          ]);
        } catch (startErr: any) {
          throw new Error("start_game failed: " + parseStartError(startErr));
        }
      }

      // ── Step 4: schedule_tick (skip if game already Active) ─────────────────
      // Use time-remaining from NOW (not endsAt - startedAt) because startedAt
      // is still 0 in React state at this point — start_game just ran on ER
      // but the poll hasn't updated yet. Using startedAt=0 gives ~17B iterations.
      const now = Math.floor(Date.now() / 1000);
      const secsRemaining = Math.max(60, game.endsAt.toNumber() - now);
      const iterations = Math.ceil((secsRemaining * 1000) / 100) + 200;

      console.log("[schedule_tick] game.endsAt:", game.endsAt.toNumber(), "now:", now, "secsRemaining:", secsRemaining, "iterations:", iterations);

      if (erGameStatus === "active") {
        setStartStatus("Crank already running — skipping.");
      } else {
        setStartStatus("Scheduling crank…");
        console.log("[schedule_tick] scheduling with", iterations, "iterations @100ms =", (iterations * 100 / 1000).toFixed(0), "seconds");
        const scheduleIx = await (erProgramSigned.methods as any)
          .scheduleTick(game.gameId, {
            taskId: new BN(1),
            executionIntervalMillis: new BN(100),
            iterations: new BN(iterations),
          })
          .accounts({
            magicProgram: MAGIC_PROGRAM_ID,
            payer: sessionKp.publicKey,
            creator: game.creator,
            game: gamePDA,
            priceFeed: ORACLE_SOL_USD,
            program: PROGRAM_ID,
          })
          .instruction();
        const scheduleTx = new Transaction().add(scheduleIx);
        const scheduleBh = await erConn.getLatestBlockhash("confirmed");
        scheduleTx.recentBlockhash = scheduleBh.blockhash;
        scheduleTx.feePayer = sessionKp.publicKey;
        scheduleTx.sign(sessionKp);
        try {
          const scheduleSig = await erConn.sendRawTransaction(
            scheduleTx.serialize(),
            { skipPreflight: true }
          );
          await erConn.confirmTransaction(
            {
              blockhash: scheduleBh.blockhash,
              lastValidBlockHeight: scheduleBh.lastValidBlockHeight,
              signature: scheduleSig,
            },
            "confirmed"
          );
          console.log("[schedule_tick] confirmed:", scheduleSig);
          setTxLinks((prev) => [
            ...prev,
            { label: "Crank Scheduled (ER)", sig: scheduleSig },
          ]);
        } catch (schedErr: any) {
          // Crank already scheduled is not fatal — warn but don't block
          const msg = parseStartError(schedErr);
          const alreadyScheduled =
            msg.toLowerCase().includes("already") ||
            msg.toLowerCase().includes("task");
          if (alreadyScheduled) {
            setStartStatus("Crank already scheduled — skipping.");
          } else {
            throw new Error("schedule_tick failed: " + msg);
          }
        }
      }

      setStartStatus("Game started!");
    } catch (e: any) {
      console.error("[delegate-and-start] failed:", e);
      setStartError(parseStartError(e));
      setStartStatus(null);
    } finally {
      setStarting(false);
    }
  };

  const handleCommitAndSettle = async () => {
    if (!publicKey || !signTransaction || !gamePDA || !game) return;
    setSettling(true);
    setSettleError(null);
    setSettleProgress("Starting settlement…");
    try {
      const erConn = getErConnection();
      // Session keypair for ER (feeless, no popup).
      // Wallet (publicKey) used for L1 settle so any connected wallet can pay fees.
      const { sessionKp } = await getSessionIdentity(publicKey, l1Connection);
      const erSignerKey = sessionKp.publicKey;

      // Check if game is already committed to L1 (owned by Flow program and undelegated)
      const gameAccountInfo = await l1Connection.getAccountInfo(gamePDA);
      const alreadyCommitted = !!gameAccountInfo?.owner.equals(PROGRAM_ID) && "ended" in game.status;

      if (!alreadyCommitted) {
        const erProgram = getProgram(
          new AnchorProvider(erConn, {} as any, { commitment: "confirmed" })
        );

        let committedOnL1 = false;
        try {
          await (erProgram.account as any).gameState.fetch(gamePDA);
        } catch {
          const info = await l1Connection.getAccountInfo(gamePDA);
          if (info?.owner.equals(PROGRAM_ID)) committedOnL1 = true;
          else throw new Error("Game account not found on ER or L1");
        }

        if (!committedOnL1) {
          const playerRemainingAccounts = game.players.map((p) => ({
            pubkey: getPlayerPDA(gamePDA, p)[0],
            isSigner: false,
            isWritable: true,
          }));
          const commitIx = await (erProgram.methods as any)
            .commitAndSettle()
            .accounts({ signer: erSignerKey, game: gamePDA, priceFeed: ORACLE_SOL_USD, systemProgram: SystemProgram.programId })
            .remainingAccounts(playerRemainingAccounts)
            .instruction();

          const tx = new Transaction().add(commitIx);
          const { value: { blockhash, lastValidBlockHeight } } = await erConn.getLatestBlockhashAndContext();
          tx.recentBlockhash = blockhash;
          tx.feePayer = erSignerKey;
          tx.sign(sessionKp);
          const erSig = await erConn.sendRawTransaction(tx.serialize(), { skipPreflight: true });

          setSettleProgress("Confirming on Ephemeral Rollup…");
          await erConn.confirmTransaction({ blockhash, lastValidBlockHeight, signature: erSig }, "confirmed");

          const txInfo = await erConn.getTransaction(erSig, { maxSupportedTransactionVersion: 0 });
          if (txInfo?.meta?.err) throw new Error("commitAndSettle failed: " + JSON.stringify(txInfo.meta.err));

          setSettleProgress("Waiting for L1 commitment…");
          await GetCommitmentSignature(erSig, erConn);
        }
      }

      // L1 settle — caller is the connected wallet (any signer OK per contract).
      // Sign with wallet so fees come from the caller's real account, no session needed.
      setSettleProgress("Distributing payouts on L1… (approve wallet)");
      const l1Program = getProgram(
        new AnchorProvider(l1Connection, {} as any, { commitment: "confirmed" })
      );
      const [vaultPDA] = getVaultPDA(gamePDA);
      const TREASURY = new PublicKey("mtqK4nCocC1A7K13oMxqcRY8DPbqAbVwmg7iCY5NvQU");
      const settleIx = await (l1Program.methods as any)
        .settle()
        .accounts({ game: gamePDA, vault: vaultPDA, caller: publicKey, treasury: TREASURY })
        .remainingAccounts(game.players.map((w) => ({ pubkey: w, isSigner: false, isWritable: true })))
        .instruction();

      const settleTx = new Transaction().add(settleIx);
      const { blockhash: sBh, lastValidBlockHeight: sLvbh } = await l1Connection.getLatestBlockhash("confirmed");
      settleTx.recentBlockhash = sBh;
      settleTx.feePayer = publicKey;
      const signedSettleTx = await signTransaction(settleTx);
      const sig = await l1Connection.sendRawTransaction(signedSettleTx.serialize(), { skipPreflight: true });
      await l1Connection.confirmTransaction({ blockhash: sBh, lastValidBlockHeight: sLvbh, signature: sig }, "confirmed");

      setSettleSig(sig);
      setSettleProgress(null);
    } catch (e: any) {
      setSettleError(e?.message ?? "Settlement failed");
      setSettleProgress(null);
    } finally {
      setSettling(false);
    }
  };

  const handleCopyLink = () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <a href="/" className="text-gray-500 hover:text-gray-300 text-sm">
          ← Back
        </a>
        <span className="text-xs text-gray-700 font-mono">
          {gamePDA.toBase58()}
        </span>
      </div>

      {/* Waiting room */}
      {isWaiting && (
        <div className="border border-gray-800 rounded p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-yellow-400 font-bold">
              Waiting for players ({game.playerCount}/{game.maxPlayers})
            </div>
            <button
              onClick={handleCopyLink}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-gray-700 hover:border-gray-500 text-gray-400 hover:text-gray-200 rounded transition-colors"
            >
              {copied ? (
                <>
                  <span className="text-green-400">✓</span>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <span>🔗</span>
                  <span>Copy invite link</span>
                </>
              )}
            </button>
          </div>
          <div className="text-xs text-gray-400">
            Entry: {feeSol} SOL | Loss limit: {game.lossLimit}%
          </div>
          {!isPlayer && !isFull && (
            <div className="space-y-2">
              {joinError && (
                <div className="text-red-400 text-xs">{joinError}</div>
              )}
              {joinSig && (
                <div className="text-xs">
                  <a
                    href={EXPLORER(joinSig)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline hover:text-blue-300 font-mono"
                  >
                    ↗ Join tx: {joinSig.slice(0, 8)}…{joinSig.slice(-8)}
                  </a>
                </div>
              )}
              <button
                onClick={handleJoin}
                disabled={joining}
                className="w-full py-2 bg-blue-800 hover:bg-blue-700 disabled:bg-gray-800 text-white text-sm rounded"
              >
                {joining ? "Joining..." : `Join for ${feeSol} SOL`}
              </button>
              <div className="text-xs text-gray-600 text-center">
                Session key created in same tx
              </div>
            </div>
          )}
          {isCreator && isFull && (
            <div className="space-y-2">
              {startStatus && (
                <div className="text-blue-400 text-xs">{startStatus}</div>
              )}
              {startError && (
                <div className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-2 py-1">
                  {startError}
                </div>
              )}
              {txLinks.map(({ label, sig }) => (
                <div key={sig} className="text-xs">
                  <a
                    href={EXPLORER(sig)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 underline hover:text-blue-300 font-mono"
                  >
                    ↗ {label}: {sig.slice(0, 8)}…{sig.slice(-8)}
                  </a>
                </div>
              ))}
              {/* Delegation status checklist */}
              {delegationStatus && (
                <div className="border border-gray-800 rounded px-3 py-2 space-y-1">
                  <div className="text-xs text-gray-600 uppercase tracking-wider mb-1">
                    Delegation Status
                  </div>
                  {delegationStatus.map(({ label, delegated }) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 text-xs font-mono"
                    >
                      <span
                        className={
                          delegated ? "text-green-400" : "text-red-400"
                        }
                      >
                        {delegated ? "✓" : "✗"}
                      </span>
                      <span
                        className={
                          delegated ? "text-gray-300" : "text-gray-500"
                        }
                      >
                        {label}
                      </span>
                      <span
                        className={
                          delegated ? "text-green-600" : "text-red-600"
                        }
                      >
                        {delegated ? "delegated" : "not delegated"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleCheckDelegation}
                  disabled={starting}
                  className="py-2 px-3 border border-gray-700 hover:border-gray-500 disabled:border-gray-800 text-gray-400 hover:text-gray-200 disabled:text-gray-700 text-xs rounded"
                >
                  Check Delegation
                </button>
                <button
                  onClick={handleDelegateAndStart}
                  disabled={starting}
                  className="flex-1 py-2 bg-green-800 hover:bg-green-700 disabled:bg-gray-800 disabled:text-gray-600 text-white text-sm rounded font-bold"
                >
                  {starting
                    ? startStatus ?? "Starting..."
                    : "Delegate & Start Game"}
                </button>
              </div>
              <div className="text-xs text-gray-600 text-center">
                1-2 popups: session (if new) + delegation — start &amp; crank
                run silently
              </div>
            </div>
          )}
          {!isCreator && isPlayer && isFull && (
            <div className="text-xs text-gray-500 text-center py-1">
              All players joined — waiting for the creator to start.
            </div>
          )}
          {!isPlayer && isFull && (
            <div className="text-xs text-gray-500 text-center py-1">
              Game is full — waiting to start.
            </div>
          )}
        </div>
      )}

      {/* History panel — shown for ended or settled games (replaces GameBoard) */}
      {isEffectivelyEnded || isSettled ? (
        (() => {
          const totalPool = game.totalDeposited.toNumber();
          const scoreNums = game.scores.map((s) => s.toNumber());
          const positiveSum = scoreNums
            .filter((s) => s > 0)
            .reduce((a, b) => a + b, 0);
          const maxScore = Math.max(...scoreNums);
          const tiedWinners = scoreNums.filter((s) => s === maxScore).length;
          const payouts = scoreNums.map((s) => {
            if (positiveSum > 0)
              return s > 0 ? Math.floor((s / positiveSum) * totalPool) : 0;
            return s === maxScore ? Math.floor(totalPool / tiedWinners) : 0;
          });

          return (
            <div className="border border-gray-800 rounded p-4 space-y-4">
              {/* Header — single line, no duplication */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span
                    className={`text-xs font-bold uppercase tracking-wider px-2 py-1 rounded border ${
                      isSettled
                        ? "text-gray-400 border-gray-600"
                        : isEnded
                        ? "text-red-400 border-red-800"
                        : "text-orange-400 border-orange-800"
                    }`}
                  >
                    {isSettled ? "Settled" : isEnded ? "Ended" : "Ending…"}
                  </span>
                  <span
                    className={`text-sm font-bold ${
                      "long" in game.direction
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {"long" in game.direction ? "LONG" : "SHORT"}
                  </span>
                </div>
                <span className="text-xs text-gray-500">
                  {feeSol} SOL entry
                </span>
              </div>

              {/* Prices */}
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-xs text-gray-600 mb-1">Start Price</div>
                  <div className="text-sm font-mono text-white">
                    {game.startPrice.toNumber() > 0
                      ? `$${(game.startPrice.toNumber() * 1e-8).toFixed(4)}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Final Price</div>
                  <div className="text-sm font-mono text-white">
                    {game.finalPrice.toNumber() > 0
                      ? `$${(game.finalPrice.toNumber() * 1e-8).toFixed(4)}`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Total Pool</div>
                  <div className="text-sm font-mono text-white">
                    {(totalPool / LAMPORTS_PER_SOL).toFixed(4)} SOL
                  </div>
                </div>
              </div>

              {/* Scores + payouts per player */}
              <div className="space-y-1">
                <div className="text-xs text-gray-600 uppercase tracking-wider mb-2">
                  Results
                </div>
                {game.players.map((wallet, i) => {
                  const score = scoreNums[i] ?? 0;
                  const payout = payouts[i] ?? 0;
                  const scColor =
                    score > 0
                      ? "text-green-400"
                      : score < 0
                      ? "text-red-400"
                      : "text-gray-400";
                  const isMe =
                    publicKey && wallet.toBase58() === publicKey.toBase58();
                  const isWinner = payout > 0;
                  return (
                    <div
                      key={wallet.toBase58()}
                      className={`flex items-center justify-between px-3 py-2 rounded ${
                        isWinner
                          ? "bg-green-900/20 border border-green-800/40"
                          : "bg-gray-900"
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs font-mono">
                        <span className="text-gray-400">
                          {wallet.toBase58().slice(0, 4)}…
                          {wallet.toBase58().slice(-4)}
                        </span>
                        {isMe && <span className="text-blue-400">you</span>}
                        {i === 0 && (
                          <span className="text-gray-600">creator</span>
                        )}
                      </div>
                      <div className="text-right">
                        <div
                          className={`text-sm font-mono font-bold ${scColor}`}
                        >
                          {score > 0 ? "+" : ""}
                          {(score / 10_000).toFixed(4)}%
                        </div>
                        {payout > 0 && (
                          <div className="text-xs font-mono text-green-400">
                            +{(payout / LAMPORTS_PER_SOL).toFixed(4)} SOL
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Commit & Settle */}
              {isEffectivelyEnded && !isSettled && !!publicKey && !settleSig && (
                <div className="space-y-2">
                  {settleProgress && (
                    <div className="flex items-center gap-2 text-blue-400 text-xs">
                      <span className="animate-pulse">●</span>
                      {settleProgress}
                    </div>
                  )}
                  {settleError && (
                    <div className="text-red-400 text-xs bg-red-950/30 border border-red-900 rounded px-2 py-1">
                      {settleError}
                    </div>
                  )}
                  <button
                    onClick={handleCommitAndSettle}
                    disabled={settling}
                    className="w-full py-3 bg-purple-700 hover:bg-purple-600 disabled:bg-purple-900/50 disabled:text-purple-400 text-white font-bold rounded transition-colors"
                  >
                    {settling ? (settleProgress ?? "Settling…") : "Commit & Settle"}
                  </button>
                </div>
              )}

              {(settleSig || isSettled) && (
                <div className="space-y-2">
                  <div className="text-center text-green-400 text-sm font-bold py-3 border border-green-900/60 rounded bg-green-950/20">
                    Payouts distributed
                  </div>
                  {settleSig && (
                    <a
                      href={`https://explorer.solana.com/tx/${settleSig}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-blue-400 underline text-xs font-mono text-center"
                    >
                      View settle tx ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })()
      ) : (isActive && !timerExpired) || settling ? (
        <GameBoard game={game} gamePDA={gamePDA} />
      ) : null}
    </div>
  );
}
