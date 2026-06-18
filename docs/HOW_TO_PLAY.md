# FLOW — How It Works 

---

## Is This Real Trading? Real Tokens?

**No.**

You are NOT buying or selling SOL. You are NOT trading anything.

You put SOL into a shared pot at the start. That's the only transaction.
The game uses the **live SOL price as a scoreboard** — nothing more.
At the end, the pot gets split based on your score.

Think of it like a **fantasy sports game** — you don't own the players,
you just score points based on what they do in real life.

---

## The Basic Idea

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Players each put 0.1 SOL into a shared pot        │
│                                                     │
│   Someone holds an invisible "position"             │
│   While you hold it → SOL price change = your score │
│                                                     │
│   Pass it to someone else whenever you want         │
│                                                     │
│   Game ends → scores tallied → pot gets split       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## The "Position" — What Is It?

The position is just a label. It says: **"This person is currently scoring."**

```
Alice holds position          Bob holds position
┌──────────────┐              ┌──────────────┐
│  🎯 ALICE    │  ──PASS──►  │  🎯 BOB      │
│              │              │              │
│ SOL goes up  │              │ SOL goes up  │
│ Alice scores │              │ Bob scores   │
└──────────────┘              └──────────────┘
```

Only ONE person holds the position at a time.
The person holding it scores. Everyone else does not.

---

## Long Game vs Short Game

The creator picks a direction when creating the game.

```
LONG GAME                          SHORT GAME
─────────────────────              ─────────────────────
SOL price goes UP   → +score       SOL price goes DOWN → +score
SOL price goes DOWN → -score       SOL price goes UP   → -score

"I want to hold when price rises"  "I want to hold when price falls"
```

All players play the same direction. You compete on TIMING — not direction.

---

## How You Win

```
╔══════════════════════════════════════════════════════╗
║  STRATEGY: Hold the position when price moves        ║
║            in the game's direction.                  ║
║            Pass it before it reverses.               ║
╚══════════════════════════════════════════════════════╝

EXAMPLE (Long game — you score when SOL goes up)

Timeline:
  100 ──────────────────────────────────────────► time

  Alice holds:  100 --> 102  (+2%)   score: +200 bp  WIN
  Bob holds:    102 --> 101  (-1%)   score: -100 bp  LOSS
  Alice holds:  101 --> 103  (+2%)   score: +200 bp  WIN

  Final scores:
    Alice: +200 + 200 = +400 bp  <-- WINNER
    Bob:   -100 bp
```

---

## How You Lose

```
EXAMPLE (Long game)

Timeline:
  100 --> 98 --> 96 --> 99

  Alice holds the whole time without passing

  Alice score:  100 --> 96  (-4%)   score: -400 bp  LOSS
  Bob score:    (never held, scored nothing)

  Bob held nothing but also scored nothing.
  Alice held too long and got punished.

  LESSON: Pass before the price reverses.
```

---

## Score Formula (in plain English)

```
Long game:
  Your score = how much % SOL went UP while you held × 10,000

Short game:
  Your score = how much % SOL went DOWN while you held × 10,000

The ×10,000 just converts percentage to basis points (bp).
  1% move = 100 bp
  0.5% move = 50 bp

You can hold the position multiple times.
All your holds add up.
```

---

## Who Gets Paid at the End

```
THE VAULT (everyone's entry fees combined)
         │
         ▼
┌─────────────────────────────────────────────┐
│  Situation 1: At least one positive score   │
│                                             │
│  Only winners (score > 0) split the pot     │
│  Your share = your score ÷ total winning    │
│               scores × pot                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Situation 2: Everyone has negative score   │
│                                             │
│  The least-bad player(s) split the pot      │
│  (Someone has to win)                       │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Situation 3: All zero scores               │
│                                             │
│  Full refund — everyone gets their SOL back │
└─────────────────────────────────────────────┘
```

---

## Full Payout Example

```
Game: Long, 3 players, 0.1 SOL each
Vault = 0.3 SOL

Final scores:
  Alice:  +400 bp
  Bob:    +100 bp
  Carol:  -200 bp

Total positive score = 400 + 100 = 500 bp

Alice gets:  400/500 x 0.3 SOL = 0.24 SOL   (put in 0.1, got back 0.24)
Bob gets:    100/500 x 0.3 SOL = 0.06 SOL   (put in 0.1, got back 0.06)
Carol gets:  0                               (put in 0.1, got back 0)

Alice won Carol's and most of Bob's entry fee.
```

---

## Game End Conditions

The game ends automatically when one of two things happens:

```
CONDITION 1: Timer runs out
┌──────────────────────────────────────────┐
│  Creator set end time = 5 minutes        │
│  5 minutes pass → game ends              │
│  Last holder's score calculated          │
└──────────────────────────────────────────┘

CONDITION 2: Loss limit hit
┌──────────────────────────────────────────┐
│  Creator set loss limit = 5%             │
│  SOL drops 5% against the game direction │
│  Game ends immediately                   │
│  Protects everyone from a runaway loss   │
└──────────────────────────────────────────┘
```

---

## Full Game Flow (Diagram)

```
SETUP PHASE
───────────
Creator opens game
    │
    ├─ Picks: Long or Short
    ├─ Picks: entry fee (e.g. 0.1 SOL)
    ├─ Picks: max players (2–8)
    ├─ Picks: end time (e.g. 5 minutes)
    └─ Picks: loss limit (e.g. 5%)
    │
    ▼
Players join + pay entry fee → vault fills up
    │
    ▼
Creator activates game (one transaction)
    │
    ▼

GAME PHASE
──────────
SOL price snapshotted at start
    │
    ▼
Automatic price tracker runs every 100ms ──────────────┐
    │                                                   │
    │  Players pass the position to each other          │
    │  (instant, no wallet popup)                       │
    │                                                   │
    │  Each pass → score calculated for the passer      │
    │  New holder → starts accumulating from here       │
    ▼                                                   │
Timer expires OR loss limit hit ◄──────────────────────┘
    │
    ▼

SETTLEMENT PHASE
────────────────
Final score for last holder calculated
    │
    ▼
All scores committed to Solana (permanent, public)
    │
    ▼
Vault distributed proportionally
    │
    ▼
Game over ✓
```

---

## What About the SOL in the Vault?

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  The vault is a LOCKED PROGRAM ACCOUNT.             │
│                                                     │
│  ✗ Creator cannot take it                           │
│  ✗ No one person controls it                        │
│  ✓ Only the settlement code can release it          │
│  ✓ Settlement formula is public, fixed, immutable   │
│                                                     │
│  Think of it like an escrow that runs itself.       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## What If the Game Never Starts?

```
Players join but the timer runs out before the game begins?

Creator calls cancel_game
    │
    ▼
Every player gets their exact entry fee back
    │
    ▼
No winners, no losers — full refund
```

---

## Summary in One Paragraph

FLOW is a timing game played with real SOL price movement. You pay a small entry fee that goes into a shared pot. One player at a time holds the "position" — while you hold it, the SOL price change becomes your score. Pass it before the price moves against you, hold it when it moves in your favor. At the end, whoever earned positive score splits the pot based on how much they scored. No real trading, no tokens, no middleman — just a transparent scoring game backed by live market data and enforced by code on Solana.
