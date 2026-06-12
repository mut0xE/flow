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
import { MAGIC_PROGRAM_ID } from "@magicblock-labs/ephemeral-rollups-sdk";

describe("flow", () => {
  dotenv.config();

  const connection = new Connection(
    // process.env.ANCHOR_PROVIDER_URL!,
    process.env.HELIUS_RPC,
    "confirmed"
  );
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

  const erProvider = getErProvider(provider.wallet as anchor.Wallet);

  const erProgram = new Program<Flow>(program.idl, erProvider);

  const creator = provider.wallet.payer;
  const player2 = loadPlayer(process.env.PLAYER2);

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

  const ENTRY_FEE = new BN(0.1 * LAMPORTS_PER_SOL);
  const LOSS_LIMIT = 5;
  const MAX_PLAYERS = 2;
  const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 300);

  before(async () => {
    logSection("SETUP");

    // airdrop to player2
    // await airdropFromWallet(
    //   provider,
    //   creator,
    //   player2.publicKey,
    //   0.001 * LAMPORTS_PER_SOL
    // );

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

    // ── Verify GameState ───────────────────────────
    const game = await program.account.gameState.fetch(gamePDA);
    logField("status", game.status);
    logField("player_count", game.playerCount);
    logField("entry_fee", game.entryFee.toString());
    logField("total_deposited", game.totalDeposited.toString());
    logField("direction", game.direction);
    logField("loss_limit", game.lossLimit);
    logField("max_players", game.maxPlayers);
    logField("current_holder", game.currentHolder.toString());
    logField("startTime", game.startedAt.toString());
    logField("endTime", game.endsAt.toString());
    logField("priceNow", game.solPriceNow.toString());

    assert.deepEqual(game.status, { waiting: {} });
    assert.equal(game.playerCount, 1);
    assert.equal(game.entryFee.toString(), ENTRY_FEE.toString());
    assert.equal(game.totalDeposited.toString(), ENTRY_FEE.toString());
    assert.deepEqual(game.direction, { long: {} });
    assert.equal(game.lossLimit, LOSS_LIMIT);
    assert.equal(game.maxPlayers, MAX_PLAYERS);
    assert.equal(game.currentHolder.toString(), creator.publicKey.toString());

    // ── Verify creator PlayerAccount ───────────────
    const creatorPlayer = await program.account.playerAccount.fetch(
      creatorPlayerPDA
    );
    logField("creator.index", creatorPlayer.index);
    logField("creator.wallet", creatorPlayer.wallet.toString());

    assert.equal(creatorPlayer.index, 0);
    assert.equal(creatorPlayer.wallet.toString(), creator.publicKey.toString());
    assert.equal(creatorPlayer.game.toString(), gamePDA.toString());

    // ── Verify vault received entry fee ────────────
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

    // ── Verify GameState updated ───────────────────
    const game = await program.account.gameState.fetch(gamePDA);
    logField("player_count", game.playerCount);
    logField("total_deposited", game.totalDeposited.toString());
    logField("status", game.status);

    assert.equal(game.playerCount, 2);
    assert.equal(
      game.totalDeposited.toString(),
      ENTRY_FEE.muln(2).toString() // 2 × entry_fee
    );
    assert.deepEqual(game.status, { waiting: {} }); // still waiting

    // ── Verify player2 PlayerAccount ───────────────
    const player2Account = await program.account.playerAccount.fetch(
      player2PlayerPDA
    );

    logField("player2.index", player2Account.index);
    logField("player2.wallet", player2Account.wallet.toString());
    logField("player2.game", player2Account.game.toString());

    assert.equal(player2Account.index, 1);
    assert.equal(
      player2Account.wallet.toString(),
      player2.publicKey.toString()
    );
    assert.equal(player2Account.game.toString(), gamePDA.toString());

    // ── Verify vault received both entry fees ──────
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

  it("delegates GameAccount to ER", async () => {
    logSection("TEST 5: delegate GameAccount");

    const txHash = await delegateToEr(
      program,
      provider.connection,
      creator,
      gamePDA,
      { gameState: { gameId: GAME_ID, creator: creator.publicKey } },
      ER_VALIDATOR
    );

    logTx("delegate_game", txHash);
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
    logField("player_count", game.playerCount);
    logField("entry_fee", game.entryFee.toString());
    logField("total_deposited", game.totalDeposited.toString());
    logField("direction", game.direction);
    logField("loss_limit", game.lossLimit);
    logField("max_players", game.maxPlayers);
    logField("current_holder", game.currentHolder.toString());
    logField("startTime", game.startedAt.toString());
    logField("endTime", game.endsAt.toString());
    logField("priceNow", game.solPriceNow.toString());
    logField("startPrice", game.startPrice.toString());

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
});
