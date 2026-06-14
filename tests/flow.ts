/**
 * FLOW — Happy Path Tests
 * Tests full game lifecycle from creation to settlement
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
  // L1 provider and program
  const connection = new Connection(process.env.HELIUS_RPC!, "confirmed");
  const provider = new anchor.AnchorProvider(
    connection,
    anchor.AnchorProvider.env().wallet,
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    }
  );
  anchor.setProvider(provider);

  const program = anchor.workspace.flow as Program<Flow>;

  // ER provider and program
  const erProvider = getErProvider(provider.wallet as anchor.Wallet);
  const erProgram = new Program<Flow>(program.idl, erProvider);

  // Test wallets
  const creator = provider.wallet.payer;
  const player2 = loadPlayer(process.env.PLAYER2);

  // Game PDAs
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

  // Session keys
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
  const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 60);

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

  it("creates game with correct state", async () => {
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

    // Verify GameState
    const game = await program.account.gameState.fetch(gamePDA);
    logField("status", game.status);
    logField("player_count", game.playerCount);
    logField("entry_fee", game.entryFee.toString());
    logField("total_deposited", game.totalDeposited.toString());
    logField("direction", game.direction);
    logField("loss_limit", game.lossLimit);
    logField("max_players", game.maxPlayers);
    logField("current_holder", game.currentHolder.toString());

    assert.deepEqual(game.status, { waiting: {} });
    assert.equal(game.playerCount, 1);
    assert.equal(game.entryFee.toString(), ENTRY_FEE.toString());
    assert.equal(game.totalDeposited.toString(), ENTRY_FEE.toString());
    assert.deepEqual(game.direction, { long: {} });
    assert.equal(game.lossLimit, LOSS_LIMIT);
    assert.equal(game.maxPlayers, MAX_PLAYERS);
    assert.equal(game.currentHolder.toString(), creator.publicKey.toString());

    // Verify creator PlayerAccount
    const creatorPlayer = await program.account.playerAccount.fetch(
      creatorPlayerPDA
    );
    logField("creator.index", creatorPlayer.index);
    logField("creator.wallet", creatorPlayer.wallet.toString());

    assert.equal(creatorPlayer.index, 0);
    assert.equal(creatorPlayer.wallet.toString(), creator.publicKey.toString());
    assert.equal(creatorPlayer.game.toString(), gamePDA.toString());

    // Verify vault received entry fee
    const vaultBal = await provider.connection.getBalance(vaultPDA);
    logField("vault balance", `${vaultBal} lamports`);
    assert.equal(vaultBal, ENTRY_FEE.toNumber());
  });

  it("player2 joins game", async () => {
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

    // Verify GameState updated
    const game = await program.account.gameState.fetch(gamePDA);
    logField("player_count", game.playerCount);
    logField("total_deposited", game.totalDeposited.toString());

    assert.equal(game.playerCount, 2);
    assert.equal(game.totalDeposited.toString(), ENTRY_FEE.muln(2).toString());
    assert.deepEqual(game.status, { waiting: {} });

    // Verify player2 PlayerAccount
    const player2Account = await program.account.playerAccount.fetch(
      player2PlayerPDA
    );
    logField("player2.index", player2Account.index);
    logField("player2.wallet", player2Account.wallet.toString());

    assert.equal(player2Account.index, 1);
    assert.equal(
      player2Account.wallet.toString(),
      player2.publicKey.toString()
    );
    assert.equal(player2Account.game.toString(), gamePDA.toString());

    // Verify vault received both entry fees
    const vaultBal = await provider.connection.getBalance(vaultPDA);
    logField("vault balance", `${vaultBal} lamports`);
    assert.equal(vaultBal, ENTRY_FEE.muln(2).toNumber());
  });

  it("delegates creator PlayerAccount to ER", async () => {
    logSection("TEST 3: delegate creatorPlayerAccount");

    const txHash = await delegateToEr(
      program,
      provider.connection,
      creator,
      creatorPlayerPDA,
      { playerAccount: { game: gamePDA, player: creator.publicKey } },
      ER_VALIDATOR
    );

    logTx("delegate_creatorPlayer", txHash);
  });

  it("delegates player2 PlayerAccount to ER", async () => {
    logSection("TEST 4: delegate player2PlayerAccount");

    const txHash = await delegateToEr(
      program,
      provider.connection,
      player2,
      player2PlayerPDA,
      { playerAccount: { game: gamePDA, player: player2.publicKey } },
      ER_VALIDATOR
    );

    logTx("delegate_player2Player", txHash);
  });

  it("delegates GameAccount to ER (with escrow top-up)", async () => {
    logSection("TEST 5: delegate GameAccount");

    const delegateIx = await program.methods
      .delegateAccount({
        gameState: { gameId: GAME_ID, creator: creator.publicKey },
      })
      .accounts({
        payer: creator.publicKey,
        pda: gamePDA,
        validator: ER_VALIDATOR,
      })
      .instruction();

    // Escrow top-up must be in same tx as delegation
    const escrowPDA = escrowPdaFromEscrowAuthority(creator.publicKey);
    const topUpEscrowIx = createTopUpEscrowInstruction(
      escrowPDA,
      creator.publicKey,
      creator.publicKey,
      100_000
    );

    const tx = new Transaction().add(delegateIx, topUpEscrowIx);
    const txHash = await sendAndConfirmTransaction(
      provider.connection,
      tx,
      [creator],
      { skipPreflight: true, commitment: "confirmed" }
    );

    logTx("delegate_game + escrow_topup", txHash);
  });

  it("starts the game", async () => {
    const sig = await erProgram.methods
      .startGame()
      .accounts({
        creator: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        creatorPlayer: creatorPlayerPDA,
        priceFeed: SOL_USD_FEED,
      })
      .rpc();

    logTx("start_game:", sig);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    logField("status", game.status);
    logField("startPrice", game.startPrice.toString());
    logField("current_holder", game.currentHolder.toString());

    assert.deepEqual(game.status, { active: {} });
    assert.ok(game.startPrice.gt(new BN(0)));
  });

  it("schedules the crank", async () => {
    const tx = await erProgram.methods
      .scheduleTick(GAME_ID, {
        taskId: new BN(1),
        executionIntervalMillis: new BN(100),
        iterations: new BN(3000),
      })
      .accounts({
        magicProgram: MAGIC_PROGRAM_ID,
        payer: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        holderPlayer: creatorPlayerPDA,
        priceFeed: SOL_USD_FEED,
        program: program.programId,
      })
      .signers([creator])
      .rpc();

    logTx("schedule_tick tx:", tx);
  });

  it("creates session for creator", async () => {
    logSection("TEST 8: create session (creator)");

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

  it("creates session for player2", async () => {
    logSection("TEST 9: create session (player2)");

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

  it("creator passes position to player2 using session key", async () => {
    logSection("TEST 10: pass (creator → player2)");

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

    logTx("pass", sig);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    const playerAccount = await erProgram.account.playerAccount.fetch(
      creatorPlayerPDA
    );

    logField("current_holder", game.currentHolder.toString());
    logField("creator score", game.scores[0].toString());
    logField("price_now", game.solPriceNow.toNumber() / 1e8);
    logField("start price", game.startPrice.toNumber() / 1e8);
    logField(
      "price received at",
      playerAccount.priceAtReceive.toNumber() / 1e8
    );

    assert.equal(game.currentHolder.toString(), player2.publicKey.toString());
  });

  it("player2 passes position to creator using session key", async () => {
    logSection("TEST 11: pass (player2 → creator)");

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

    logTx("pass", sig);

    const game = await erProgram.account.gameState.fetch(gamePDA);
    const playerAccount = await erProgram.account.playerAccount.fetch(
      player2PlayerPDA
    );

    logField("current_holder", game.currentHolder.toString());
    logField("player score", game.scores[1].toString());
    logField("price_now", game.solPriceNow.toNumber() / 1e8);
    logField("start price", game.startPrice.toNumber() / 1e8);
    logField(
      "price received at",
      playerAccount.priceAtReceive.toNumber() / 1e8
    );

    assert.equal(game.currentHolder.toString(), creator.publicKey.toString());
  });

  it("commit_and_settle after game ends", async function () {
    this.timeout(180_000);
    logSection("TEST 12: commit_and_settle");

    // Poll ER until game status == Ended
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
    logField("current_holder", game.currentHolder.toString());

    // Call commit_and_settle on ER via router
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
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(playerPDAsForCommit)
      .instruction();

    const erSig = await sendAndConfirmTransaction(
      erProvider.connection,
      new Transaction().add(commitIx),
      [creator],
      { skipPreflight: true, commitment: "confirmed" }
    );
    logTx("commit_and_settle (ER)", erSig);

    const gameAfterCommit = await erProgram.account.gameState.fetch(gamePDA);
    logField("── FINAL SCORES (after final holder scored) ──", "");
    logField(
      "scores",
      gameAfterCommit.scores.map((s) => s.toString()).join(", ")
    );
    logField("current_holder", gameAfterCommit.currentHolder.toString());
    logField("final_price", gameAfterCommit.finalPrice.toString());

    // Wait for L1 commit
    const l1CommitSig = await GetCommitmentSignature(
      erSig,
      erProvider.connection
    );
    logTx("L1 commit landed", l1CommitSig);
    console.log("\n   Game committed to L1. Calling settle() on L1...");

    const creatorBalBefore = await provider.connection.getBalance(
      creator.publicKey
    );
    const player2BalBefore = await provider.connection.getBalance(
      player2.publicKey
    );
    const vaultBalBefore = await provider.connection.getBalance(vaultPDA);
    const treasuryBalBefore = await provider.connection.getBalance(TREASURY);

    logField("── BEFORE SETTLE ──", "");
    logField("vault balance", `${vaultBalBefore} lamports`);
    logField(
      "creator balance",
      `${(creatorBalBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    logField(
      "player2 balance",
      `${(player2BalBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    logField(
      "treasury balance",
      `${(treasuryBalBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );

    // Call settle on L1
    const gameOnL1 = await program.account.gameState.fetch(gamePDA);

    logField("── FINAL SCORES (after final holder scored) ──", "");
    logField("scores", gameOnL1.scores.map((s) => s.toString()).join(", "));
    logField("current_holder", gameOnL1.currentHolder.toString());
    logField("final_price", gameOnL1.finalPrice.toString());

    const walletAccountsForSettle = gameOnL1.players.map((wallet) => ({
      pubkey: wallet,
      isSigner: false,
      isWritable: true,
    }));

    const settleSig = await program.methods
      .settle()
      .accounts({
        caller: creator.publicKey,
        //@ts-ignore
        game: gamePDA,
        vault: vaultPDA,
        treasury: TREASURY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(walletAccountsForSettle)
      .rpc({ skipPreflight: true });

    logTx("settle (L1)", settleSig);

    const creatorBalAfter = await provider.connection.getBalance(
      creator.publicKey
    );
    const player2BalAfter = await provider.connection.getBalance(
      player2.publicKey
    );
    const vaultBalAfter = await provider.connection.getBalance(vaultPDA);
    const treasuryBalAfter = await provider.connection.getBalance(TREASURY);

    logField("── AFTER SETTLE ──", "");
    logField("vault", `${vaultBalAfter} lamports`);

    logField("── AFTER SETTLE ──", "");
    logField("vault", `${vaultBalAfter} lamports`);
    logField(
      "creator balance",
      `${(creatorBalAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    logField(
      "player2 balance",
      `${(player2BalAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    logField(
      "treasury balance",
      `${(treasuryBalAfter / LAMPORTS_PER_SOL).toFixed(6)} SOL`
    );
    logField(
      "creator Δ",
      `${((creatorBalAfter - creatorBalBefore) / LAMPORTS_PER_SOL).toFixed(
        6
      )} SOL`
    );
    logField(
      "player2 Δ",
      `${((player2BalAfter - player2BalBefore) / LAMPORTS_PER_SOL).toFixed(
        6
      )} SOL`
    );
    logField(
      "treasury Δ",
      `${((treasuryBalAfter - treasuryBalBefore) / LAMPORTS_PER_SOL).toFixed(
        6
      )} SOL`
    );
    console.log("\n✅ Vault distributed");
  });
});
