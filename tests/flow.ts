/**
 * FLOW — Happy Path Tests (tests 1-10)
 * Full game lifecycle: create → join → delegate → start → crank → pass → commit → settle
 */

import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Flow } from "../target/types/flow";
import dotenv from "dotenv";
import {
  getGamePDA,
  getVaultPDA,
  getPlayerPDA,
  loadPlayer,
  delegateToEr,
} from "./helpers/accounts";
import {
  logTx,
  logAccount,
  logField,
  logSection,
  randomGameId,
} from "./helpers/log";
import {
  getErProvider,
  getMagicRouter,
  waitForCommitment,
  sleep,
  SOL_USD_FEED,
  airdropFromWallet,
  getErValidator,
  ER_RPC,
} from "./helpers/connections";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { assert } from "chai";
import {
  MAGIC_PROGRAM_ID,
  GetCommitmentSignature,
  createTopUpEscrowInstruction,
  createCloseEscrowInstruction,
  escrowPdaFromEscrowAuthority,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const TREASURY = new PublicKey("mtqK4nCocC1A7K13oMxqcRY8DPbqAbVwmg7iCY5NvQU");
import { SessionTokenManager } from "@magicblock-labs/gum-sdk";
import {
  getCreatorSessionKeypair,
  getPlayer2SessionKeypair,
  SESSION_TOKEN_SEED,
} from "./helpers/session";

dotenv.config();
if (!process.env.ANCHOR_PROVIDER_URL)
  process.env.ANCHOR_PROVIDER_URL = process.env.HELIUS_RPC;

describe("flow", () => {
  // L1 provider (Helius devnet)
  const connection = new Connection(process.env.HELIUS_RPC!, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    anchor.AnchorProvider.env().wallet,
    { commitment: "confirmed", preflightCommitment: "confirmed" }
  );
  anchor.setProvider(provider);
  const program = anchor.workspace.flow as Program<Flow>;

  // ER provider (MagicBlock devnet)
  const erProvider = getErProvider(provider.wallet as anchor.Wallet);
  const erProgram = new Program<Flow>(program.idl, erProvider);

  // Wallets
  const creator = provider.wallet.payer;
  const player2 = loadPlayer(process.env.PLAYER2);

  // PDAs derived once and reused across all tests
  const GAME_ID = randomGameId();
  let ER_VALIDATOR: PublicKey;

  const gamePDA = getGamePDA(GAME_ID, creator.publicKey, program.programId);
  const vaultPDA = getVaultPDA(gamePDA, program.programId);
  const creatorPlayerPDA = getPlayerPDA(
    gamePDA,
    creator.publicKey,
    program.programId
  );
  const player2PlayerPDA = getPlayerPDA(
    gamePDA,
    player2.publicKey,
    program.programId
  );

  // Session keys (deterministic from wallet pubkey + env nonce)
  const sessionManager = new SessionTokenManager(
    provider.wallet,
    provider.connection
  );
  const sessionProgramId = sessionManager.program.programId;
  const creatorSessionKeypair = getCreatorSessionKeypair();
  const player2SessionKeypair = getPlayer2SessionKeypair();
  let creatorSessionPDA: PublicKey;
  let player2SessionPDA: PublicKey;

  // Game parameters
  const ENTRY_FEE = new BN(0.1 * LAMPORTS_PER_SOL);
  const LOSS_LIMIT = 5;
  const MAX_PLAYERS = 2;
  const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 180);

  before(async () => {
    logSection("SETUP");
    logAccount("creator", creator.publicKey);
    logAccount("player2", player2.publicKey);
    logAccount("gamePDA", gamePDA);
    logAccount("vaultPDA", vaultPDA);
    logAccount("creatorPlayer", creatorPlayerPDA);
    logAccount("player2Player", player2PlayerPDA);

    ER_VALIDATOR = await getErValidator(ER_RPC);

    const bal = await provider.connection.getBalance(creator.publicKey);
    logField("creator balance", `${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL`);
  });

  // ── TEST 1: create_game ───────────────────────────────────────────────────

  it("1. creates game with correct state", async () => {
    logSection("TEST 1: create_game");

    const tx = await program.methods
      .createGame(
        GAME_ID,
        { long: {} },
        ENTRY_FEE,
        LOSS_LIMIT,
        MAX_PLAYERS,
        ENDS_AT
      )
      .accounts({
        creator: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        vault: vaultPDA,
        player: creatorPlayerPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([creator])
      .rpc();

    logTx("create_game", tx);

    const game = await program.account.gameState.fetch(gamePDA);
    logField("status", game.status);
    logField("player_count", game.playerCount);
    logField("total_deposited", game.totalDeposited.toString());

    assert.deepEqual(game.status, { waiting: {} });
    assert.equal(game.playerCount, 1);
    assert.equal(game.entryFee.toString(), ENTRY_FEE.toString());
    assert.equal(game.totalDeposited.toString(), ENTRY_FEE.toString());
    assert.deepEqual(game.direction, { long: {} });
    assert.equal(game.lossLimit, LOSS_LIMIT);
    assert.equal(game.maxPlayers, MAX_PLAYERS);
    assert.equal(game.currentHolder.toString(), creator.publicKey.toString());

    // Creator gets index 0
    const creatorPlayer = await program.account.playerAccount.fetch(
      creatorPlayerPDA
    );
    assert.equal(creatorPlayer.index, 0);
    assert.equal(creatorPlayer.wallet.toString(), creator.publicKey.toString());
    assert.equal(creatorPlayer.game.toString(), gamePDA.toString());

    // Vault holds exactly one entry fee
    const vaultBal = await provider.connection.getBalance(vaultPDA);
    assert.equal(vaultBal, ENTRY_FEE.toNumber());
    logField("vault balance", `${vaultBal} lamports`);
  });

  // ── TEST 2: join_game ─────────────────────────────────────────────────────

  it("2. player2 joins game", async () => {
    logSection("TEST 2: join_game");

    const tx = await program.methods
      .joinGame()
      .accounts({
        player: player2.publicKey,
        //@ts-ignore
        game: gamePDA,
        vault: vaultPDA,
        playerAccount: player2PlayerPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc({ skipPreflight: true });

    logTx("join_game", tx);

    const game = await program.account.gameState.fetch(gamePDA);
    assert.equal(game.playerCount, 2);
    assert.equal(game.totalDeposited.toString(), ENTRY_FEE.muln(2).toString());
    assert.deepEqual(game.status, { waiting: {} });

    // Player2 gets index 1
    const player2Account = await program.account.playerAccount.fetch(
      player2PlayerPDA
    );
    assert.equal(player2Account.index, 1);
    assert.equal(
      player2Account.wallet.toString(),
      player2.publicKey.toString()
    );

    // Vault holds both entry fees
    const vaultBal = await provider.connection.getBalance(vaultPDA);
    assert.equal(vaultBal, ENTRY_FEE.muln(2).toNumber());
    logField("vault balance", `${vaultBal} lamports`);
  });

  // ── TEST 3: delegate all PDAs + start_game ────────────────────────────────
  // Single L1 tx: escrow top-up + all 3 delegations (creator pays for all).
  // Then start_game on ER — creator signs directly (no session token needed).

  it("3. delegates all PDAs and starts game on ER", async () => {
    logSection("TEST 3: delegate all PDAs + start_game");

    const delegateCreatorPlayerIx = await program.methods
      .delegateAccount({
        playerAccount: { game: gamePDA, player: creator.publicKey },
      })
      .accounts({
        payer: creator.publicKey,
        pda: creatorPlayerPDA,
        validator: ER_VALIDATOR,
      })
      .instruction();

    const delegatePlayer2PlayerIx = await program.methods
      .delegateAccount({
        playerAccount: { game: gamePDA, player: player2.publicKey },
      })
      .accounts({
        payer: creator.publicKey,
        pda: player2PlayerPDA,
        validator: ER_VALIDATOR,
      })
      .instruction();

    const delegateGameIx = await program.methods
      .delegateAccount({
        gameState: { gameId: GAME_ID, creator: creator.publicKey },
      })
      .accounts({
        payer: creator.publicKey,
        pda: gamePDA,
        validator: ER_VALIDATOR,
      })
      .instruction();

    // Top up escrow so the magic action (settle) has fees on L1
    const escrowPDA = escrowPdaFromEscrowAuthority(creator.publicKey);
    const topUpEscrowIx = createTopUpEscrowInstruction(
      escrowPDA,
      creator.publicKey,
      creator.publicKey,
      0.005 * LAMPORTS_PER_SOL
    );
    logAccount("escrowPDA", escrowPDA);

    const delegateTx = new Transaction().add(
      topUpEscrowIx,
      delegateCreatorPlayerIx,
      delegatePlayer2PlayerIx,
      delegateGameIx
    );
    const delegateTxHash = await sendAndConfirmTransaction(
      provider.connection,
      delegateTx,
      [creator],
      { skipPreflight: true, commitment: "confirmed" }
    );
    logTx("delegate_all + escrow_top_up", delegateTxHash);

    // start_game: creator wallet signs directly; session_auth_or fallback passes
    const startGameIx = await erProgram.methods
      .startGame()
      .accounts({
        signer: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        creatorPlayer: creatorPlayerPDA,
        priceFeed: SOL_USD_FEED,
      })
      .instruction();

    const startTx = new Transaction().add(startGameIx);
    startTx.feePayer = creator.publicKey;
    startTx.recentBlockhash = (
      await erProvider.connection.getLatestBlockhash()
    ).blockhash;
    startTx.sign(creator);
    const startSig = await erProvider.connection.sendRawTransaction(
      startTx.serialize(),
      {
        skipPreflight: true,
      }
    );
    await erProvider.connection.confirmTransaction(startSig, "confirmed");
    logTx("start_game", startSig, true);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    logField("status", game.status);
    logField("startPrice", game.startPrice.toString());

    assert.deepEqual(game.status, { active: {} });
    assert.ok(game.startPrice.gt(new BN(0)));
  });

  // ── TEST 4: schedule_tick (crank) ─────────────────────────────────────────
  // Schedules tick_price to run every 100ms for 3000 iterations on ER.

  it("4. schedules the price crank", async () => {
    logSection("TEST 4: schedule_tick");

    const tx = await erProgram.methods
      .scheduleTick(GAME_ID, {
        taskId: new BN(1),
        executionIntervalMillis: new BN(100),
        iterations: new BN(3000),
      })
      .accounts({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: creator.publicKey,
        creator: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        priceFeed: SOL_USD_FEED,
        program: program.programId,
      })
      .signers([creator])
      .rpc();

    logTx("schedule_tick", tx, true);
  });

  // ── TEST 5: create session (creator) ──────────────────────────────────────
  // Session allows future pass() calls without a wallet popup.

  it("5. creates session for creator", async () => {
    logSection("TEST 5: create session (creator)");

    creatorSessionPDA = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SESSION_TOKEN_SEED),
        program.programId.toBytes(),
        creatorSessionKeypair.publicKey.toBytes(),
        creator.publicKey.toBytes(),
      ],
      sessionProgramId
    )[0];

    const existing = await provider.connection.getAccountInfo(
      creatorSessionPDA
    );
    if (existing) {
      console.log("   session already exists, skipping creation");
    } else {
      const tx = await sessionManager.program.methods
        .createSessionV2(
          true,
          new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
          new anchor.BN(0.005 * LAMPORTS_PER_SOL)
        )
        .accounts({
          targetProgram: program.programId,
          sessionSigner: creatorSessionKeypair.publicKey,
          feePayer: creator.publicKey,
          authority: creator.publicKey,
        })
        .transaction();

      tx.feePayer = creator.publicKey;
      const txHash = await sendAndConfirmTransaction(
        provider.connection,
        tx,
        [creator, creatorSessionKeypair],
        { commitment: "confirmed" }
      );
      logTx("createSession_creator", txHash);
    }

    logAccount("sessionTokenPDA", creatorSessionPDA);
    console.log("\n✅ Creator session ready");
  });

  // ── TEST 6: create session (player2) ─────────────────────────────────────

  it("6. creates session for player2", async () => {
    logSection("TEST 6: create session (player2)");

    const p2SessionManager = new SessionTokenManager(
      new anchor.Wallet(player2),
      provider.connection
    );

    player2SessionPDA = PublicKey.findProgramAddressSync(
      [
        Buffer.from(SESSION_TOKEN_SEED),
        program.programId.toBytes(),
        player2SessionKeypair.publicKey.toBytes(),
        player2.publicKey.toBytes(),
      ],
      p2SessionManager.program.programId
    )[0];

    const existing = await provider.connection.getAccountInfo(
      player2SessionPDA
    );
    if (existing) {
      console.log("   session already exists, skipping creation");
    } else {
      const tx = await p2SessionManager.program.methods
        .createSessionV2(
          true,
          new anchor.BN(Math.floor(Date.now() / 1000) + 3600),
          new anchor.BN(0.005 * LAMPORTS_PER_SOL)
        )
        .accounts({
          targetProgram: program.programId,
          sessionSigner: player2SessionKeypair.publicKey,
          feePayer: player2.publicKey,
          authority: player2.publicKey,
        })
        .transaction();

      tx.feePayer = player2.publicKey;
      const txHash = await sendAndConfirmTransaction(
        provider.connection,
        tx,
        [player2, player2SessionKeypair],
        { commitment: "confirmed" }
      );
      logTx("createSession_player2", txHash);
    }

    logAccount("sessionTokenPDA", player2SessionPDA);
    console.log("\n✅ Player2 session ready");
  });

  // ── TEST 7: pass (creator → player2) ─────────────────────────────────────
  // Session key signs — no wallet popup. Score accumulated in basis points.

  it("7. creator passes position to player2", async () => {
    logSection("TEST 7: pass (creator → player2)");

    // Wait for crank to update price at least once
    await new Promise((r) => setTimeout(r, 5000));

    const tx = await erProgram.methods
      .pass()
      .accounts({
        signer: creatorSessionKeypair.publicKey,
        //@ts-ignore
        game: gamePDA,
        holderPlayer: creatorPlayerPDA,
        nextPlayer: player2PlayerPDA,
        sessionToken: creatorSessionPDA,
        priceFeed: SOL_USD_FEED,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(
      erProvider.connection,
      tx,
      [creatorSessionKeypair],
      { skipPreflight: true, commitment: "confirmed" }
    );
    logTx("pass", sig, true);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    logField("current_holder", game.currentHolder.toString());
    logField("creator score (bp)", game.scores[0].toString());

    assert.equal(game.currentHolder.toString(), player2.publicKey.toString());
  });

  // ── TEST 8: pass (player2 → creator) ─────────────────────────────────────

  it("8. player2 passes position back to creator", async () => {
    logSection("TEST 8: pass (player2 → creator)");

    await new Promise((r) => setTimeout(r, 5000));

    const tx = await erProgram.methods
      .pass()
      .accounts({
        signer: player2SessionKeypair.publicKey,
        //@ts-ignore
        game: gamePDA,
        holderPlayer: player2PlayerPDA,
        nextPlayer: creatorPlayerPDA,
        sessionToken: player2SessionPDA,
        priceFeed: SOL_USD_FEED,
      })
      .transaction();

    const sig = await sendAndConfirmTransaction(
      erProvider.connection,
      tx,
      [player2SessionKeypair],
      { skipPreflight: true, commitment: "confirmed" }
    );
    logTx("pass", sig, true);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    logField("current_holder", game.currentHolder.toString());
    logField("player2 score (bp)", game.scores[1].toString());

    assert.equal(game.currentHolder.toString(), creator.publicKey.toString());
  });

  // ── TEST 9: commit_and_settle ─────────────────────────────────────────────
  // Poll ER until game Ended, then commit + undelegate. Magic action auto-settles on L1.

  it("9. commit_and_settle after game ends", async function () {
    this.timeout(180_000);
    logSection("TEST 9: commit_and_settle");

    // Poll ER until status = Ended
    const start = Date.now();
    let game = await erProgram.account.gameState.fetch(gamePDA);
    while (!("ended" in game.status) && Date.now() - start < 330_000) {
      await sleep(2);
      game = await erProgram.account.gameState.fetch(gamePDA);
      logField("game status", JSON.stringify(game.status));
    }
    assert.deepEqual(game.status, { ended: {} }, "Game must be Ended");
    logField("final_price", game.finalPrice.toString());
    logField("scores", game.scores.map((s) => s.toString()).join(", "));

    // Send commit_and_settle via magic router
    const router = getMagicRouter();
    const routerProvider = new anchor.AnchorProvider(
      router as any,
      provider.wallet,
      {
        commitment: "confirmed",
      }
    );
    const routerProgram = new Program<Flow>(program.idl, routerProvider);

    const playerPDAsForCommit = game.players.map((wallet) => ({
      pubkey: getPlayerPDA(gamePDA, wallet, program.programId),
      isSigner: false,
      isWritable: true,
    }));

    const commitIx = await routerProgram.methods
      .commitAndSettle()
      .accounts({
        signer: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        priceFeed: SOL_USD_FEED,
      })
      .remainingAccounts(playerPDAsForCommit)
      .instruction();

    const erSig = await sendAndConfirmTransaction(
      routerProvider.connection,
      new Transaction().add(commitIx),
      [creator],
      { skipPreflight: true, commitment: "confirmed" }
    );
    logTx("commit_and_settle (ER)", erSig, true);

    // Wait for L1 commit to land
    const l1CommitSig = await GetCommitmentSignature(
      erSig,
      erProvider.connection
    );
    logTx("L1 commit landed", l1CommitSig);
    console.log("\n   Game committed to L1. Magic action will auto-settle...");

    // Poll L1 until magic action fires settle()
    const settlePollStart = Date.now();
    let gameOnL1 = await program.account.gameState.fetch(gamePDA);
    while (
      !("settled" in gameOnL1.status) &&
      Date.now() - settlePollStart < 60_000
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      gameOnL1 = await program.account.gameState.fetch(gamePDA);
      logField("L1 game status", JSON.stringify(gameOnL1.status));
    }

    assert.deepEqual(
      gameOnL1.status,
      { settled: {} },
      "magic action must auto-settle"
    );
    logField("✅ auto-settled", "status=Settled on L1");

    const vaultBalAfter = await provider.connection.getBalance(vaultPDA);
    logField("vault after", `${vaultBalAfter} lamports`);
    assert.equal(vaultBalAfter, 0, "vault must be drained by magic action");
    console.log("\n✅ Vault distributed by magic action");
  });

  // ── TEST 10: verify settlement ────────────────────────────────────────────
  // Confirms status=Settled, vault=0, and that a second settle() call is rejected.

  it("10. verify settlement — AlreadySettled on double call", async () => {
    logSection("TEST 10: verify settlement");

    const game = await program.account.gameState.fetch(gamePDA);
    assert.deepEqual(game.status, { settled: {} });

    const walletAccounts = game.players.map((wallet) => ({
      pubkey: wallet,
      isSigner: false,
      isWritable: true,
    }));

    // settle() uses #[action] macro — direct call after magic action returns "Unknown action"
    const escrowAuthKey = creator.publicKey;
    const escrowKey = escrowPdaFromEscrowAuthority(escrowAuthKey);

    try {
      await program.methods
        .settle()
        .accounts({
          game: gamePDA,
          //@ts-ignore
          vault: vaultPDA,
          treasury: TREASURY,
          systemProgram: SystemProgram.programId,
          //@ts-ignore
          escrowAuth: escrowAuthKey,
          escrow: escrowKey,
        })
        .remainingAccounts(walletAccounts)
        .rpc({ skipPreflight: true });
      assert.fail("Expected AlreadySettled but tx succeeded");
    } catch (err: any) {
      const msg: string = err?.message ?? err?.toString() ?? "";
      assert.ok(
        msg.includes("AlreadySettled") || msg.includes("Unknown action"),
        `Expected AlreadySettled or Unknown action, got: ${msg}`
      );
      logField("✅ AlreadySettled", "double settle correctly rejected");
    }

    // Close escrow to recover remaining lamports back to creator
    const escrowPDA = escrowPdaFromEscrowAuthority(creator.publicKey);
    const closeEscrowIx = createCloseEscrowInstruction(
      escrowPDA,
      creator.publicKey
    );
    const closeSig = await provider.sendAndConfirm(
      new Transaction().add(closeEscrowIx),
      [creator]
    );
    logTx("close_escrow", closeSig);
    logField("✅ escrow closed", "lamports returned to creator");
  });
});
