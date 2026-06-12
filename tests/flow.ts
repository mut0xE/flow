import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Flow } from "../target/types/flow";
import dotenv from "dotenv";
import {
  getGamePDA,
  getVaultPDA,
  getPlayerPDA,
  loadPlayer,
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
  ER_VALIDATOR,
  SOL_USD_FEED,
  airdropFromWallet,
  L1_ENDPOINT,
} from "./helpers/connections";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import { assert } from "chai";

describe("flow", () => {
  dotenv.config();

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.flow as Program<Flow>;

  const erProvider = getErProvider(provider.wallet as anchor.Wallet);

  const creator = provider.wallet.payer;
  const player2 = loadPlayer(process.env.PLAYER2);

  const GAME_ID = randomGameId();

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
    logAccount("player2Player", player2PlayerPDA);

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
      .rpc({ skipPreflight: true });

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
});
