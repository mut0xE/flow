"use client";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PublicKey, Transaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import BN from "bn.js";
import {
  MAGIC_PROGRAM_ID,
  GetCommitmentSignature,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { type Address } from "@solana/kit";
import { useGame } from "@/hooks/useGame";
import { GameBoard } from "@/components/game/GameBoard";
import { l1Connection, getErConnection, ER_RPC } from "@/lib/connections";
import { FLOW_PROGRAM_ADDRESS } from "@/generated/programs/flow";
import { fetchMaybeGameState } from "@/generated/accounts/gameState";
import { getJoinGameInstructionAsync } from "@/generated/instructions/joinGame";
import { getDelegateAccountInstructionAsync } from "@/generated/instructions/delegateAccount";
import { getStartGameInstruction } from "@/generated/instructions/startGame";
import { getScheduleTickInstructionAsync } from "@/generated/instructions/scheduleTick";
import { getCommitAndSettleInstruction } from "@/generated/instructions/commitAndSettle";
import { getCancelGameInstruction } from "@/generated/instructions/cancelGame";
import { getPlayerPDA, getVaultPDA } from "@/lib/pdas";
import { getErRpc } from "@/lib/rpc";
import { toWeb3Ix } from "@/lib/ix";

const PROGRAM_ID = new PublicKey(FLOW_PROGRAM_ADDRESS);
import { GameStatus } from "@/generated/types/gameStatus";
import { Direction } from "@/generated/types/direction";
import { ORACLE_SOL_USD } from "@/lib/oracle";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { buildCreateSessionIx, getSessionIdentity } from "@/lib/session";
import { useEffect, useRef } from "react";
import { useTxToast } from "@/components/shell/TxToast";

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
  } catch (e) {
    console.warn("[getDelegationStatus] fetch error:", e);
    return false;
  }
}

const DELEGATION_PROGRAM = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);

async function isOwnedByDelegationProgram(pubkey: PublicKey): Promise<boolean> {
  try {
    const info = await l1Connection.getAccountInfo(pubkey);
    return !!info && info.owner.equals(DELEGATION_PROGRAM);
  } catch {
    return false;
  }
}

// Poll router until all pubkeys show isDelegated:true, with L1 ownership fallback.
// Router can lag 60–90s behind on-chain state — if L1 confirms all accounts are
// owned by the delegation program, proceed rather than blocking indefinitely.
async function pollUntilDelegated(
  pubkeys: PublicKey[],
  onProgress: (msg: string) => void,
  timeoutMs = 90_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const statuses = await Promise.all(pubkeys.map(getDelegationStatus));
    if (statuses.every(Boolean)) return;

    // Fallback: if all accounts are owned by the delegation program on L1, the
    // delegation is real even if the router hasn't indexed it yet.
    const l1Owned = await Promise.all(
      pubkeys.map(isOwnedByDelegationProgram)
    );
    if (l1Owned.every(Boolean)) {
      onProgress("Delegation confirmed on L1 — waiting 5s for ER to sync…");
      await new Promise((r) => setTimeout(r, 5000));
      return;
    }

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

const ER_EXPLORER = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=https%3A%2F%2Fdevnet-as.magicblock.app%2F`;

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
  const { game, loading, refetch } = useGame(gamePDA ? gamePDA.toBase58() as Address : null);
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const { addToast } = useTxToast();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const settleStorageKey = gamePDA ? `flow_settlesig_${gamePDA.toBase58()}` : null;
  const joinStorageKey = gamePDA ? `flow_joinsig_${gamePDA.toBase58()}` : null;

  const [copied, setCopied] = useState(false);
  // Settle state — lives here so it survives the Active→Ended layout switch
  const [settling, setSettling] = useState(false);
  const [settleError, setSettleError] = useState<string | null>(null);
  const [settleSig, setSettleSig] = useState<string | null>(() => {
    if (typeof window === "undefined" || !gamePDA) return null;
    try { return localStorage.getItem(`flow_settlesig_${gamePDA.toBase58()}`); } catch { return null; }
  });
  const [joinSig, setJoinSig] = useState<string | null>(() => {
    if (typeof window === "undefined" || !gamePDA) return null;
    try { return localStorage.getItem(`flow_joinsig_${gamePDA.toBase58()}`); } catch { return null; }
  });
  const [pageTimeLeft, setPageTimeLeft] = useState("");
  const [pageTimePct, setPageTimePct] = useState(1);
  const pageTotalRef = useRef<number | null>(null);

  // Page-level countdown for the top timer bar
  useEffect(() => {
    if (!game || game.status !== GameStatus.Active) return;
    const endsAt = Number(game.endsAt);
    const startedAt = Number(game.startedAt ?? 0);
    const total = startedAt > 0 ? endsAt - startedAt : null;
    if (total != null) pageTotalRef.current = total;
    const tick = () => {
      const diff = Math.max(0, endsAt - Math.floor(Date.now() / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      setPageTimeLeft(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      const t = pageTotalRef.current;
      setPageTimePct(t && t > 0 ? diff / t : 1);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [game?.endsAt, game?.status]);

  useEffect(() => {
    if (settleStorageKey && settleSig) localStorage.setItem(settleStorageKey, settleSig);
  }, [settleSig, settleStorageKey]);

  useEffect(() => {
    if (joinStorageKey && joinSig) localStorage.setItem(joinStorageKey, joinSig);
  }, [joinSig, joinStorageKey]);

  if (!gamePDA)
    return <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: "var(--red)", padding: 20 }}>INVALID GAME ADDRESS</div>;
  if (loading && !game) return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 40, fontFamily: "'VT323', monospace", fontSize: 16, color: "var(--text-muted)" }}>
      <span style={{ width: 12, height: 12, border: "3px solid var(--text-muted)", borderTopColor: "var(--navy)", display: "inline-block", animation: "spin .8s linear infinite" }} />
      LOADING GAME…
    </div>
  );
  if (!game) return <div style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 11, color: "var(--text-muted)", padding: 20 }}>GAME NOT FOUND</div>;

  const isPlayer =
    publicKey &&
    game.players.some((p) => p === publicKey.toBase58());
  const isCreator =
    publicKey && game.creator === publicKey.toBase58();
  const isWaiting = game.status === GameStatus.Waiting;
  const isActive = game.status === GameStatus.Active;
  const isEnded = game.status === GameStatus.Ended;
  const isSettled = game.status === GameStatus.Settled;
  const timerExpired = Number(game.endsAt) <= Math.floor(Date.now() / 1000);
  // Treat as ended if on-chain says ended OR timer has expired (crank may lag)
  const isEffectivelyEnded = isEnded || timerExpired;
  const isFull = game.playerCount >= game.maxPlayers;
  const feeSol = Number(game.entryFee) / LAMPORTS_PER_SOL;

  // join_game + createSessionV2 in one tx — one popup for the player
  const handleJoin = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions || !gamePDA)
      return;
    setJoining(true);
    setJoinError(null);
    setJoinSig(null);
    try {
      const joinIx = await getJoinGameInstructionAsync({
        player: { address: publicKey.toBase58() as Address, signTransactions: async (t: any) => t } as any,
        game: gamePDA.toBase58() as Address,
      });
      const tx = new Transaction().add(toWeb3Ix(joinIx));

      // Bundle session creation into same tx, skipping stale wrong-owner tokens.
      const { sessionKp, exists: existingSession } = await getSessionIdentity(
        publicKey,
        l1Connection
      );

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
      addToast({ label: "JOINED GAME", sig, variant: "success" });
    } catch (e: any) {
      const msg = parseJoinError(e);
      setJoinError(msg);
      addToast({ label: "JOIN FAILED", variant: "error" });
    } finally {
      setJoining(false);
    }
  };

  function parseTxError(e: any): string {
    if (e?.error?.errorMessage) return e.error.errorMessage;
    const logs: string[] =
      e?.logs ??
      e?.transactionLogs ??
      (typeof e?.getLogs === "function" ? e.getLogs() : []) ??
      [];
    for (const log of logs) {
      const anchor = log.match(/AnchorError[^:]*: ([^\n]+)/);
      if (anchor) return anchor[1].trim();
      const msg = log.match(/Error Message: (.+)/);
      if (msg) return msg[1].trim();
      const transfer = log.match(/Transfer: (.+)/);
      if (transfer) return transfer[1].trim();
    }
    const raw: string = e?.message ?? String(e) ?? "Unknown error";
    const simMatch = raw.match(
      /Transaction simulation failed: (.+?)(?:\. Logs:|$)/
    );
    if (simMatch) return simMatch[1].trim();
    return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
  }

  const parseJoinError = parseTxError;
  const parseStartError = parseTxError;

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

    try {
      // ── Step 1: session key ──────────────────────────────────────────────────
      const {
        sessionKp,
        sessionPDA,
        exists: existingSession,
      } = await getSessionIdentity(publicKey, l1Connection);
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
        addToast({ label: "SESSION KEY CREATED", sig: sessionSig, variant: "success" });
        await l1Connection.confirmTransaction(
          {
            blockhash: sBh,
            lastValidBlockHeight: sLvbh,
            signature: sessionSig,
          },
          "confirmed"
        );
      }

      // ── Step 2: delegation — check ALL accounts via router, not just game ──────
      const erConn = getErConnection();

      const allPDAs: PublicKey[] = [
        ...game.players.map((w) => getPlayerPDA(gamePDA, new PublicKey(w as string))[0]),
        gamePDA,
      ];

      const delegationStatuses = await Promise.all(
        allPDAs.map(getDelegationStatus)
      );
      const allDelegated = delegationStatuses.every(Boolean);
      const delegatedCount = delegationStatuses.filter(Boolean).length;

      if (!allDelegated) {
        const validator = await fetchErValidator();
        const delegateTx = new Transaction();
        const payerSigner = { address: publicKey.toBase58() as Address, signTransactions: async (t: any) => t } as any;
        for (const playerWallet of game.players) {
          const playerPubkey = new PublicKey(playerWallet as string);
          const [playerPDA] = getPlayerPDA(gamePDA, playerPubkey);
          const ix = await getDelegateAccountInstructionAsync({
            payer: payerSigner,
            pda: playerPDA.toBase58() as Address,
            validator: validator.toBase58() as Address,
            accountType: { __kind: "PlayerAccount", player: playerPubkey.toBase58() as Address, game: gamePDA.toBase58() as Address },
          });
          delegateTx.add(toWeb3Ix(ix));
        }
        const gameDelIx = await getDelegateAccountInstructionAsync({
          payer: payerSigner,
          pda: gamePDA.toBase58() as Address,
          validator: validator.toBase58() as Address,
          accountType: { __kind: "GameState", gameId: BigInt(game.gameId.toString()), creator: (game.creator as string) as Address },
        });
        delegateTx.add(toWeb3Ix(gameDelIx));
        let delegateSig: string;
        try {
          delegateSig = await sendL1SkipPreflight(
            delegateTx,
            publicKey,
            signTransaction as any
          );
          // skipPreflight means failed txs still confirm — verify success explicitly
          const delegateTxInfo = await l1Connection.getTransaction(delegateSig, {
            maxSupportedTransactionVersion: 0,
          });
          if (delegateTxInfo?.meta?.err) {
            const logs = delegateTxInfo.meta.logMessages ?? [];
            const logStr = logs.join("\n");
            throw new Error(
              "Delegation tx failed on-chain: " +
                JSON.stringify(delegateTxInfo.meta.err) +
                (logStr ? "\n" + logStr : "")
            );
          }
          addToast({ label: "ACCOUNTS DELEGATED", sig: delegateSig, variant: "success" });
        } catch (delegateErr: any) {
          throw new Error("Delegation failed: " + parseStartError(delegateErr));
        }
      }

      // ── Step 3: start_game (skip if already Active on ER) ───────────────────
      let erGameStatus: string | null = null;
      try {
        const erGameAcc = await fetchMaybeGameState(getErRpc(), gamePDA.toBase58() as Address);
        if (erGameAcc?.exists) {
          const s = erGameAcc.data.status;
          if (s === GameStatus.Active) erGameStatus = "active";
          else if (s === GameStatus.Ended) erGameStatus = "ended";
          else if (s === GameStatus.Settled) erGameStatus = "settled";
        }
      } catch {
        /* couldn't read — proceed */
      }

      const [creatorPlayerPDA] = getPlayerPDA(gamePDA, publicKey);
      const sessionSigner = { address: sessionKp.publicKey.toBase58() as Address, signTransactions: async (t: any) => t } as any;

      if (!(
        erGameStatus === "active" ||
        erGameStatus === "ended" ||
        erGameStatus === "settled"
      )) {
        const startGameIx = getStartGameInstruction({
          signer: sessionSigner,
          game: gamePDA.toBase58() as Address,
          creatorPlayer: creatorPlayerPDA.toBase58() as Address,
          priceFeed: ORACLE_SOL_USD.toBase58() as Address,
        });
        const startTx = new Transaction().add(toWeb3Ix(startGameIx));
        const startBh = await erConn.getLatestBlockhash("confirmed");
        startTx.recentBlockhash = startBh.blockhash;
        startTx.feePayer = sessionKp.publicKey;
        startTx.sign(sessionKp);
        try {
          const startSig = await erConn.sendRawTransaction(
            startTx.serialize(),
            { skipPreflight: true }
          );
          addToast({ label: "GAME STARTED", sig: startSig, variant: "success", erExplorer: true });
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
        } catch (startErr: any) {
          throw new Error("start_game failed: " + parseStartError(startErr));
        }
      }

      // ── Step 4: schedule_tick (skip if game already Active) ─────────────────
      // Use time-remaining from NOW (not endsAt - startedAt) because startedAt
      // is still 0 in React state at this point — start_game just ran on ER
      // but the poll hasn't updated yet. Using startedAt=0 gives ~17B iterations.
      const now = Math.floor(Date.now() / 1000);
      const secsRemaining = Math.max(60, Number(game.endsAt) - now);
      const iterations = Math.ceil((secsRemaining * 1000) / 100) + 200;

      if (erGameStatus !== "active") {
        const scheduleIx = await getScheduleTickInstructionAsync({
          magicProgram: MAGIC_PROGRAM_ID.toBase58() as Address,
          payer: sessionSigner,
          creator: (game.creator as string) as Address,
          game: gamePDA.toBase58() as Address,
          priceFeed: ORACLE_SOL_USD.toBase58() as Address,
          program: FLOW_PROGRAM_ADDRESS,
          gameId: BigInt(game.gameId.toString()),
          taskId: 1n,
          executionIntervalMillis: 100n,
          iterations: BigInt(iterations),
        });
        const scheduleTx = new Transaction().add(toWeb3Ix(scheduleIx));
        const scheduleBh = await erConn.getLatestBlockhash("confirmed");
        scheduleTx.recentBlockhash = scheduleBh.blockhash;
        scheduleTx.feePayer = sessionKp.publicKey;
        scheduleTx.sign(sessionKp);
        try {
          const scheduleSig = await erConn.sendRawTransaction(
            scheduleTx.serialize(),
            { skipPreflight: true }
          );
          addToast({ label: "CRANK SCHEDULED", sig: scheduleSig, variant: "success", erExplorer: true });
          await erConn.confirmTransaction(
            {
              blockhash: scheduleBh.blockhash,
              lastValidBlockHeight: scheduleBh.lastValidBlockHeight,
              signature: scheduleSig,
            },
            "confirmed"
          );
        } catch (schedErr: any) {
          // Crank already scheduled is not fatal — warn but don't block
          const msg = parseStartError(schedErr);
          if (!msg.toLowerCase().includes("already") && !msg.toLowerCase().includes("task")) {
            throw new Error("schedule_tick failed: " + msg);
          }
        }
      }

    } catch (e: any) {
      console.error("[delegate-and-start] failed:", e);
      setStartError(parseStartError(e));
      addToast({ label: "START FAILED", variant: "error" });
    } finally {
      setStarting(false);
    }
  };

  const handleCommitAndSettle = async () => {
    if (!publicKey || !signTransaction || !gamePDA || !game) return;
    setSettling(true);
    setSettleError(null);
    try {
      let resolvedSig: string | null = null;
      const erConn = getErConnection();
      const { sessionKp, exists: sessionExists } = await getSessionIdentity(publicKey, l1Connection);

      // Check if game is already committed to L1 (owned by Flow program and undelegated)
      const gameAccountInfo = await l1Connection.getAccountInfo(gamePDA);
      const alreadyCommitted =
        !!gameAccountInfo?.owner.equals(PROGRAM_ID) &&
        (game.status === GameStatus.Ended || game.status === GameStatus.Settled);

      if (!alreadyCommitted) {
        let committedOnL1 = false;
        const erGameAcc = await fetchMaybeGameState(getErRpc(), gamePDA.toBase58() as Address).catch(() => null);
        if (!erGameAcc?.exists) {
          const info = await l1Connection.getAccountInfo(gamePDA);
          if (info?.owner.equals(PROGRAM_ID)) committedOnL1 = true;
          else throw new Error("Game account not found on ER or L1");
        }

        if (!committedOnL1) {
          // Use session keypair (silent) only when it's valid and funded on ER.
          // Fall back to wallet when session is expired or unfunded.
          const sessionKpInfo = await erConn.getAccountInfo(sessionKp.publicKey);
          const sessionFunded = (sessionKpInfo?.lamports ?? 0) > 5_000;
          const useSession = sessionExists && sessionFunded;

          const erSignerKey = useSession ? sessionKp.publicKey : publicKey;
          const erSigner = { address: erSignerKey.toBase58() as Address, signTransactions: async (t: any) => t } as any;

          const commitTxIx = toWeb3Ix(getCommitAndSettleInstruction({
            signer: erSigner,
            game: gamePDA.toBase58() as Address,
            priceFeed: ORACLE_SOL_USD.toBase58() as Address,
          }));
          for (const p of game.players) {
            commitTxIx.keys.push({ pubkey: getPlayerPDA(gamePDA, new PublicKey(p as string))[0], isSigner: false, isWritable: true });
          }
          const commitIx = commitTxIx;

          const tx = new Transaction().add(commitIx);
          const {
            value: { blockhash, lastValidBlockHeight },
          } = await erConn.getLatestBlockhashAndContext();
          tx.recentBlockhash = blockhash;
          tx.feePayer = erSignerKey;

          let erSig: string;
          if (useSession) {
            tx.sign(sessionKp);
            erSig = await erConn.sendRawTransaction(tx.serialize(), {
              skipPreflight: true,
            });
          } else {
            const signed = await signTransaction(tx);
            erSig = await erConn.sendRawTransaction(signed.serialize(), {
              skipPreflight: true,
            });
          }

          await erConn.confirmTransaction(
            { blockhash, lastValidBlockHeight, signature: erSig },
            "confirmed"
          );

          const txInfo = await erConn.getTransaction(erSig, {
            maxSupportedTransactionVersion: 0,
          });
          if (txInfo?.meta?.err)
            throw new Error(
              "commitAndSettle failed: " + JSON.stringify(txInfo.meta.err)
            );

          resolvedSig = erSig;
          // Resolve the L1 magic-action sig in the background — don't block the toast.
          GetCommitmentSignature(erSig, erConn).then((l1Sig) => {
            if (l1Sig) {
              setSettleSig(l1Sig);
              addToast({ label: "SETTLE CONFIRMED ON DEVNET", sig: l1Sig, variant: "success" });
            }
          }).catch(() => {});
        }
      }

      setSettleSig((prev) => prev ?? resolvedSig ?? "magic-action-settled");
      addToast({ label: "GAME SETTLED · PAYOUTS SENT", sig: resolvedSig ?? undefined, variant: "success", erExplorer: true });
    } catch (e: any) {
      setSettleError(parseTxError(e));
      addToast({ label: "SETTLE FAILED", variant: "error" });
    } finally {
      setSettling(false);
    }
  };

  const handleCancelGame = async () => {
    if (!publicKey || !signTransaction || !gamePDA || !game) return;
    setSettling(true);
    setSettleError(null);
    try {
      const [vaultPDA] = getVaultPDA(gamePDA);
      const cancelTxIx = toWeb3Ix(getCancelGameInstruction({
        caller: { address: publicKey.toBase58() as Address, signTransactions: async (t: any) => t } as any,
        game: gamePDA.toBase58() as Address,
        vault: vaultPDA.toBase58() as Address,
      }));
      for (const w of game.players) {
        cancelTxIx.keys.push({ pubkey: new PublicKey(w as string), isSigner: false, isWritable: true });
      }
      const cancelIx = cancelTxIx;

      const cancelTx = new Transaction().add(cancelIx);
      const { blockhash, lastValidBlockHeight } =
        await l1Connection.getLatestBlockhash("confirmed");
      cancelTx.recentBlockhash = blockhash;
      cancelTx.feePayer = publicKey;
      const signed = await signTransaction(cancelTx);
      const sig = await l1Connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
      });
      await l1Connection.confirmTransaction(
        { blockhash, lastValidBlockHeight, signature: sig },
        "confirmed"
      );

      setSettleSig(sig);
      addToast({ label: "GAME CANCELLED · REFUNDS SENT", sig, variant: "success" });
    } catch (e: any) {
      setSettleError(parseTxError(e));
      addToast({ label: "CANCEL FAILED", variant: "error" });
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

  const px = {
    card: { border: "3px solid var(--navy)", boxShadow: "5px 5px 0 var(--navy)", background: "var(--lavender)", padding: "clamp(16px,2.5vw,24px)" } as React.CSSProperties,
    label: { fontFamily: "'VT323', monospace", fontSize: 15, color: "var(--text-muted)", letterSpacing: 0.5 } as React.CSSProperties,
    mono: { fontFamily: "'Press Start 2P', monospace" } as React.CSSProperties,
    vt: { fontFamily: "'VT323', monospace" } as React.CSSProperties,
    link: { fontFamily: "'VT323', monospace", fontSize: 15, color: "#7fe6a0", textDecoration: "underline" } as React.CSSProperties,
    err: { display: "flex", gap: 8, fontFamily: "'VT323', monospace", fontSize: 16, border: "2px solid var(--red)", background: "rgba(240,85,107,.08)", padding: "10px 12px", color: "var(--red)" } as React.CSSProperties,
  };

  const PxBtn = ({ onClick, disabled, children, variant = "dark" }: { onClick?: () => void; disabled?: boolean; children: React.ReactNode; variant?: "dark" | "green" | "yellow" | "red" | "outline" }) => {
    const bg = variant === "dark" ? "var(--navy)" : variant === "green" ? "var(--green)" : variant === "yellow" ? "var(--yellow)" : variant === "red" ? "var(--red)" : "var(--lavender)";
    const color = variant === "outline" ? "var(--navy)" : variant === "yellow" ? "var(--navy)" : "var(--lavender)";
    return (
      <button onClick={onClick} disabled={disabled} style={{
        width: "100%", ...px.mono, fontSize: 11,
        border: "3px solid var(--navy)", background: disabled ? "var(--text-muted)" : bg,
        color: disabled ? "var(--navy)" : color,
        boxShadow: "4px 4px 0 var(--navy)", padding: "14px 16px",
        cursor: disabled ? "default" : "pointer", letterSpacing: 1,
      }}>{children}</button>
    );
  };

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16, animation: "risehud .2s ease-out both" }}>
      {isActive && !timerExpired && pageTimeLeft && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 12,
          padding: "6px 0",
        }}>
          <span style={{
            fontFamily: "'Press Start 2P', monospace", fontSize: 9,
            color: "var(--text-muted)", letterSpacing: 1,
          }}>{pageTimeLeft} LEFT</span>
          <div style={{
            display: "flex", gap: 3, alignItems: "center",
          }}>
            {Array.from({ length: 12 }).map((_, i) => {
              const filled = i / 12 < pageTimePct;
              return (
                <div key={i} style={{
                  width: 14, height: 10,
                  background: filled ? "var(--green)" : "rgba(0,0,0,.15)",
                  border: "2px solid var(--navy)",
                }} />
              );
            })}
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <a href="/" style={{ ...px.mono, fontSize: 9, color: "var(--text-muted)", textDecoration: "none" }}>← BACK</a>
        <span style={{ ...px.vt, fontSize: 14, color: "var(--text-muted)" }}>{gamePDA.toBase58().slice(0, 16)}…</span>
      </div>

      {isWaiting && !isEffectivelyEnded && (
        <div style={px.card}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <span style={{ ...px.mono, fontSize: 11, color: "var(--yellow)" }}>
              WAITING · {game.playerCount}/{game.maxPlayers} PLAYERS
            </span>
            <button onClick={handleCopyLink} style={{ ...px.mono, fontSize: 9, border: "2px solid var(--navy)", background: "var(--lavender)", color: copied ? "var(--green)" : "var(--navy)", padding: "8px 10px", boxShadow: "3px 3px 0 var(--navy)", cursor: "pointer" }}>
              {copied ? "✓ COPIED" : "🔗 INVITE"}
            </button>
          </div>
          <div style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)", marginBottom: 14 }}>
            ENTRY: {feeSol} SOL · LOSS LIMIT: {game.lossLimit}%
          </div>

          {!isPlayer && !isFull && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {joinError && <div style={px.err}><span>✕</span><span>{joinError}</span></div>}
              <PxBtn onClick={handleJoin} disabled={joining} variant="dark">
                {joining ? "JOINING…" : `JOIN FOR ${feeSol} SOL ▶`}
              </PxBtn>
              <div style={{ ...px.vt, fontSize: 14, color: "var(--text-muted)", textAlign: "center" }}>Session key created in same tx</div>
            </div>
          )}

          {isCreator && isFull && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {startError && <div style={px.err}><span>✕</span><span>{startError}</span></div>}
              <button onClick={handleDelegateAndStart} disabled={starting} style={{ ...px.mono, fontSize: 11, border: "3px solid var(--navy)", background: starting ? "var(--text-muted)" : "var(--green)", color: "var(--lavender)", boxShadow: "4px 4px 0 var(--navy)", padding: "12px", cursor: starting ? "default" : "pointer", letterSpacing: 1 }}>
                {starting ? "STARTING…" : "START GAME ▶"}
              </button>
            </div>
          )}

          {!isCreator && isPlayer && isFull && (
            <div style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>All players joined — waiting for creator to start.</div>
          )}
          {!isPlayer && isFull && (
            <div style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>Game is full — waiting to start.</div>
          )}
        </div>
      )}

      {isEffectivelyEnded || isSettled || (isWaiting && timerExpired) ? (() => {
        const totalPool = Number(game.totalDeposited);
        const scoreNums = game.scores.map((s) => Number(s));
        const positiveSum = scoreNums.filter((s) => s > 0).reduce((a, b) => a + b, 0);
        const maxScore = Math.max(...scoreNums);
        const tiedWinners = scoreNums.filter((s) => s === maxScore).length;
        const payouts = scoreNums.map((s) => {
          if (positiveSum > 0) return s > 0 ? Math.floor((s / positiveSum) * totalPool) : 0;
          return s === maxScore ? Math.floor(totalPool / tiedWinners) : 0;
        });
        const statusStr = isSettled ? "SETTLED" : isEnded ? "ENDED" : isWaiting ? "EXPIRED" : "ENDING…";
        const statusColor = isSettled ? "var(--text-muted)" : isEnded ? "var(--red)" : "var(--yellow)";
        const dir = game.direction === Direction.Long ? "LONG" : "SHORT";

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={px.card}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ ...px.mono, fontSize: 10, border: "3px solid var(--navy)", padding: "6px 8px", color: statusColor }}>{statusStr}</span>
                  <span style={{ ...px.mono, fontSize: 11, border: "3px solid var(--navy)", background: "var(--navy)", padding: "7px 9px", color: dir === "LONG" ? "#8fe3a8" : "#ff9fb0" }}>{dir === "LONG" ? "▲" : "▼"} {dir}</span>
                </div>
                <span style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)" }}>{feeSol} SOL ENTRY</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
                {[
                  ["START", Number(game.startPrice) > 0 ? `$${(Number(game.startPrice) * 1e-8).toFixed(4)}` : "—"],
                  ["FINAL", Number(game.finalPrice) > 0 ? `$${(Number(game.finalPrice) * 1e-8).toFixed(4)}` : "—"],
                  ["POOL", `${(totalPool / LAMPORTS_PER_SOL).toFixed(4)} ◎`],
                ].map(([lbl, val]) => (
                  <div key={lbl} style={{ border: "2px solid var(--navy)", padding: "10px 12px", textAlign: "center" }}>
                    <div style={{ ...px.vt, fontSize: 14, color: "var(--text-muted)", marginBottom: 6 }}>{lbl}</div>
                    <div style={{ ...px.mono, fontSize: 10, color: "var(--navy)" }}>{val}</div>
                  </div>
                ))}
              </div>

              <div style={{ ...px.mono, fontSize: 9, color: "var(--text-muted)", marginBottom: 10 }}>
                {isWaiting ? "PLAYERS (REFUND PENDING)" : "RESULTS"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {game.players.map((wallet, i) => {
                  const score = scoreNums[i] ?? 0;
                  const payout = payouts[i] ?? 0;
                  const isMe = publicKey && wallet === publicKey.toBase58();
                  const isWinner = payout > 0;
                  const scoreColor = score > 0 ? "var(--green)" : score < 0 ? "var(--red)" : "var(--text-muted)";
                  return (
                    <div key={wallet} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
                      border: "3px solid var(--navy)",
                      boxShadow: isWinner && !isWaiting ? "4px 4px 0 var(--navy),0 0 12px rgba(52,184,99,.3)" : "4px 4px 0 var(--navy)",
                      background: isWinner && !isWaiting ? "rgba(52,184,99,.08)" : "var(--lavender)",
                      padding: "10px 12px",
                    }}>
                      <div style={{ ...px.vt, fontSize: 15, color: "var(--navy)" }}>
                        #{i + 1} {wallet.slice(0, 4)}…{wallet.slice(-4)}
                        {isMe && <span style={{ color: "var(--text-blue)", marginLeft: 8 }}>YOU</span>}
                        {i === 0 && <span style={{ color: "var(--text-muted)", marginLeft: 8 }}>creator</span>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {isWaiting ? (
                          <div style={{ ...px.mono, fontSize: 9, color: "var(--yellow)" }}>{feeSol.toFixed(4)} ◎ refund</div>
                        ) : (
                          <>
                            <div style={{ ...px.mono, fontSize: 10, color: scoreColor }}>{score > 0 ? "+" : ""}{(score / 10_000).toFixed(4)}%</div>
                            {payout > 0 && <div style={{ ...px.vt, fontSize: 12, color: "var(--green)" }}>+{(payout / LAMPORTS_PER_SOL).toFixed(4)} ◎</div>}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {(settleSig || isSettled) && (
              <div style={{
                textAlign: "center", ...px.mono, fontSize: "clamp(16px,3vw,24px)",
                border: "3px solid var(--navy)", background: "var(--yellow)", color: "var(--navy)",
                boxShadow: "5px 5px 0 var(--navy)", padding: 20, letterSpacing: 2,
                animation: "holdglow 1.8s steps(2) infinite",
              }}>★ PAYOUTS DISTRIBUTED ★</div>
            )}

            {isWaiting && timerExpired && !isSettled && !settleSig && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)", textAlign: "center" }}>Game expired — entry fees will be refunded to all players</div>
                {settleError && <div style={px.err}><span>✕</span><span>{settleError}</span></div>}
                {isCreator ? (
                  <PxBtn onClick={handleCancelGame} disabled={settling} variant="red">
                    {settling ? "REFUNDING…" : "CANCEL & REFUND ▶"}
                  </PxBtn>
                ) : (
                  <div style={{ ...px.vt, fontSize: 16, color: "var(--text-muted)", textAlign: "center", padding: "8px 0" }}>Waiting for the creator to cancel and refund.</div>
                )}
              </div>
            )}

            {isEffectivelyEnded && !isWaiting && !isSettled && !!publicKey && !settleSig && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {settleError && <div style={px.err}><span>✕</span><span>{settleError}</span></div>}
                <PxBtn onClick={handleCommitAndSettle} disabled={settling} variant="dark">
                  {settling ? "SETTLING…" : "COMMIT & SETTLE ▶"}
                </PxBtn>
              </div>
            )}
          </div>
        );
      })() : (isActive && !timerExpired) || settling ? (
        <GameBoard game={game} gamePDA={gamePDA} />
      ) : null}
    </div>
  );
}
