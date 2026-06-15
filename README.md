# FLOW

A real-time on-chain game where players compete by holding a virtual position that tracks live SOL/USD price movement. No real asset is transferred between players — what gets passed is the right to accumulate price movement score. Your score is the basis points of SOL price movement in the game direction while you held the position. At game end, the shared vault (entry fees) is distributed proportionally by score.


## Overview

| | |
|---|---|
| Network | Solana Devnet |
| Program ID | `4ZAPNxawvTPH41hJ2VhWGwGttPWNXmbqnXFwehTCjyPs` |
| IDL Account | `B2eS1Zw1qLZYr4sqH4zETwJugKaLpSarxMq1d4LQ6syD` |
| ER RPC | `https://devnet.magicblock.app` |
| L1 RPC | Helius Devnet |

---

## How It Works

1. A creator opens a game by choosing a direction (Long or Short), entry fee, loss limit percentage, max players (2-8), and an end time.
2. Other players join and pay the entry fee into an on-chain vault PDA.
3. Once all slots are filled, the creator delegates all game PDAs to MagicBlock Ephemeral Rollups (ER) in a single transaction, then starts the game. Pyth records the SOL/USD price at that moment as the start price.
4. A price crank runs every 100ms on the ER, pulling the latest Pyth price and checking end conditions (time expiry or loss limit breach).
5. Players pass the position to each other using session keys. No wallet popup is required — passes are sub-second and gasless on the ER.
6. When the game ends (crank sets status = Ended), the final state is committed back to L1 and the vault is distributed by score.

The position is not a real asset. It is a marker — tracked in `GameState.current_holder` — that determines who is actively accumulating price movement score at any given moment. Players earn more by holding when price moves favorably and lose score if price moves against the game direction while they hold.

---

## Score Model

```
LONG:  score = (price_at_pass - price_at_receive) / price_at_receive * 10000
SHORT: score = (price_at_receive - price_at_pass) / price_at_receive * 10000
```

Score is in basis points. A player can receive the position multiple times — scores accumulate across all holds.

**Settlement:**

| Scenario | Payout |
|---|---|
| At least one positive score | Players with score > 0 share the pool proportionally |
| All scores negative | Players with the highest (least negative) score split equally |
| All scores zero | Full refund split equally across all players |

Rounding dust goes to the treasury.

---

## Architecture

```
Solana L1  (Helius Devnet)
  create_game       — GameState + Vault + creator PlayerAccount
  join_game         — player PlayerAccount, entry fee deposited
  delegate_account  — locks PDAs and mirrors them to ER
  settle            — distributes vault after committed state lands on L1

Ephemeral Rollup  (devnet.magicblock.app)
  start_game        — reads Pyth price, marks game Active
  schedule_tick     — registers 100ms price crank
  tick_price        — (auto) updates live price, checks end conditions
  pass              — transfers position marker, accumulates score
  commit_and_settle — commits final state, undelegates PDAs back to L1
```

Session keys (session-keys 3.1.1) allow all ER instructions to run without a wallet popup. Each player bundles session key creation into their `create_game` or `join_game` transaction — one popup per player, valid for 30 days.

---

## Program Details

### State Accounts

**GameState** — seeds: `["game", game_id_le_bytes, creator]`

Holds all game metadata: players list, per-player scores, current holder pubkey, Pyth prices (start, live, final), game status, vault bump, and timing.

**PlayerAccount** — seeds: `["player", game_pda, wallet]`

Stores `price_at_receive` — the Pyth price snapshot when this player received the position. Score is calculated against this value on the next pass.

**Vault** — seeds: `["vault", game_pda]`

Plain system account PDA. Holds all entry fee SOL until settlement.

---

## Getting Started

### Prerequisites

- Rust and Solana CLI
- Anchor CLI 0.32.1
- Node.js 18+
- A funded Solana devnet wallet

### Install

```bash
git clone <repo-url>
cd flow
yarn install
```

### Environment

Create a `.env` file in the project root:

```env
HELIUS_RPC=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
ANCHOR_WALLET=~/.config/solana/id.json
PLAYER2=/path/to/player2-keypair.json
CREATOR_SESSION_KEY=[...secret key array...]
PLAYER2_SESSION_KEY=[...secret key array...]
```

`CREATOR_SESSION_KEY` and `PLAYER2_SESSION_KEY` are auto-generated on first run and stored back to `.env`. You can leave them empty initially.

### Build and Deploy

```bash
anchor build
anchor deploy --provider.cluster devnet
```

---

## Running Tests

The test suite requires two funded devnet wallets (`ANCHOR_WALLET` and `PLAYER2`) and a valid `HELIUS_RPC` in `.env`.

```bash
# Happy-path suite — full game lifecycle (tests 1-13)
yarn test:flow

# Run all tests including failure cases
yarn test:all
```

Test scripts are defined in `package.json`:

```json
"test:flow": "ts-mocha -p ./tsconfig.json -t 1000000 \"tests/flow.ts\"",
"test:all": "ts-mocha -p ./tsconfig.json -t 1000000 \"tests/flow.ts\" \"tests/failure.ts\""
```

The happy-path suite covers:

| # | What it tests |
|---|---|
| 1 | `create_game` — GameState fields, vault balance |
| 2 | `join_game` — player count, vault = 2x entry fee |
| 3-6 | Delegate all PDAs + `start_game` via session key |
| 7 | `schedule_tick` — crank registered |
| 8-9 | Session creation for creator and player2 |
| 10 | `pass` creator to player2 |
| 11 | `pass` player2 back to creator |
| 12 | `commit_and_settle` — polls ER for Ended, commits, settles |
| 13 | Verify settlement — vault drained, payouts match score formula |

---

## Docs

Architecture diagrams (Mermaid) are in the `docs/` folder:

- [docs/diagrams.md](docs/diagrams.md) — full game lifecycle, session key flow, score settlement flowchart, PDA derivation, and delegation sequence
