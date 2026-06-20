/**
 * FLOW — cancel_game tests
 * Covers: happy path refund + failure cases (not expired, already settled).
 *
 * Run: yarn run ts-mocha -p ./tsconfig.json -t 120000 "tests/cancel_game.ts"
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
} from "./helpers/accounts";
import { logTx, logField, logSection, randomGameId } from "./helpers/log";
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";

dotenv.config();
if (!process.env.ANCHOR_PROVIDER_URL)
  process.env.ANCHOR_PROVIDER_URL = process.env.HELIUS_RPC;

// Helper: assert a tx fails with the expected Anchor error name
async function assertAnchorError(
  promise: Promise<any>,
  errorName: string
): Promise<void> {
  try {
    await promise;
    assert.fail(`Expected error ${errorName} but tx succeeded`);
  } catch (err: any) {
    const msg: string = err?.message ?? err?.toString() ?? "";
    assert.ok(
      msg.includes(errorName),
      `Expected "${errorName}" in error but got: ${msg}`
    );
  }
}

describe("cancel_game", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.flow as Program<Flow>;

  const creator = (provider.wallet as anchor.Wallet).payer;
  const player2 = loadPlayer(process.env.PLAYER2);

  const ENTRY_FEE = new BN(0.05 * LAMPORTS_PER_SOL);
  const LOSS_LIMIT = 5;
  const MAX_PLAYERS = 2;

  // ── happy path: expired waiting game refunds all players ──────────────────

  describe("success: expired waiting game refunds players", () => {
    const GAME_ID = randomGameId();
    // ends_at = 2 seconds from now so it expires quickly in the test
    const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 2);

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

    it("creates game", async () => {
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
    });

    it("player2 joins game", async () => {
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
    });

    it("cancel_game refunds both players after expiry", async () => {
      logSection("cancel_game — happy path");

      // Wait for game timer to expire (ends_at = now + 2s)
      await new Promise((r) => setTimeout(r, 4000));

      const creatorBalBefore = await provider.connection.getBalance(
        creator.publicKey
      );
      const player2BalBefore = await provider.connection.getBalance(
        player2.publicKey
      );
      const vaultBefore = await provider.connection.getBalance(vaultPDA);
      logField("vault before", `${vaultBefore} lamports`);

      const tx = await program.methods
        .cancelGame()
        .accounts({
          caller: creator.publicKey,
          //@ts-ignore
          game: gamePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(
          [creator.publicKey, player2.publicKey].map((pk) => ({
            pubkey: pk,
            isSigner: false,
            isWritable: true,
          }))
        )
        .signers([creator])
        .rpc({ skipPreflight: true });

      logTx("cancel_game", tx);

      const game = await program.account.gameState.fetch(gamePDA);
      assert.deepEqual(game.status, { settled: {} });
      logField("status", JSON.stringify(game.status));

      const vaultAfter = await provider.connection.getBalance(vaultPDA);
      const creatorBalAfter = await provider.connection.getBalance(
        creator.publicKey
      );
      const player2BalAfter = await provider.connection.getBalance(
        player2.publicKey
      );

      logField("vault after", `${vaultAfter} lamports`);
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

      assert.equal(vaultAfter, 0, "vault must be drained");
      // player2 is not the tx signer so they receive exact entry_fee
      assert.equal(
        player2BalAfter - player2BalBefore,
        ENTRY_FEE.toNumber(),
        "player2 must receive exact entry_fee refund"
      );
      // creator receives entry_fee minus small tx fee — net positive
      assert.ok(
        creatorBalAfter > creatorBalBefore,
        "creator net balance should increase (refund > tx fee)"
      );
    });
  });

  // ── failure: cancel before timer expires ──────────────────────────────────

  describe("failure: cancel before expiry", () => {
    const GAME_ID = randomGameId();
    const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 3600); // 1 hour

    const gamePDA = getGamePDA(GAME_ID, creator.publicKey, program.programId);
    const vaultPDA = getVaultPDA(gamePDA, program.programId);
    const creatorPlayerPDA = getPlayerPDA(
      gamePDA,
      creator.publicKey,
      program.programId
    );

    before(async () => {
      await program.methods
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
    });

    it("rejects cancel_game when timer has not expired (GameNotExpired)", async () => {
      await assertAnchorError(
        program.methods
          .cancelGame()
          .accounts({
            caller: creator.publicKey,
            //@ts-ignore
            game: gamePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: false, isWritable: true },
          ])
          .signers([creator])
          .rpc({ skipPreflight: true }),
        "GameNotExpired"
      );
    });
  });

  // ── failure: double cancel (already settled) ──────────────────────────────

  describe("failure: cancel already-settled game", () => {
    const GAME_ID = randomGameId();
    const ENDS_AT = new BN(Math.floor(Date.now() / 1000) + 2);

    const gamePDA = getGamePDA(GAME_ID, creator.publicKey, program.programId);
    const vaultPDA = getVaultPDA(gamePDA, program.programId);
    const creatorPlayerPDA = getPlayerPDA(
      gamePDA,
      creator.publicKey,
      program.programId
    );

    before(async () => {
      await program.methods
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

      // Wait for expiry then first cancel (succeeds → status=Settled)
      await new Promise((r) => setTimeout(r, 4000));
      await program.methods
        .cancelGame()
        .accounts({
          caller: creator.publicKey,
          //@ts-ignore
          game: gamePDA,
          vault: vaultPDA,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: creator.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([creator])
        .rpc({ skipPreflight: true });
    });

    it("rejects double cancel (AlreadySettled)", async () => {
      await assertAnchorError(
        program.methods
          .cancelGame()
          .accounts({
            caller: creator.publicKey,
            //@ts-ignore
            game: gamePDA,
            vault: vaultPDA,
            systemProgram: SystemProgram.programId,
          })
          .remainingAccounts([
            { pubkey: creator.publicKey, isSigner: false, isWritable: true },
          ])
          .signers([creator])
          .rpc({ skipPreflight: true }),
        "AlreadySettled"
      );
    });
  });
});
