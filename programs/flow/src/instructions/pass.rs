use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionToken};

#[derive(Accounts, Session)]
pub struct Pass<'info> {
    // current holder
    pub signer: Signer<'info>,

    #[account(
           mut,
           seeds = [GAME_SEED, game.creator.as_ref()],
           bump  = game.bump,
       )]
    pub game: Account<'info, GameState>,

    // current holder's PlayerAccount
    // used to read price_at_receive and index
    #[account(
           mut,
           seeds = [PLAYER_SEED, game.key().as_ref(), game.current_holder.as_ref()],
           bump  = holder_player.bump,
           constraint = holder_player.wallet == signer.key() @ FlowError::NotCurrentHolder,
       )]
    pub holder_player: Account<'info, PlayerAccount>,

    // next player's PlayerAccount
    // used to set their price_at_receive
    #[account(
           mut,
           seeds = [PLAYER_SEED, game.key().as_ref(), next_player.wallet.as_ref()],
           bump  = next_player.bump,
       )]
    pub next_player: Account<'info, PlayerAccount>,

    // session token — validated by #[session_auth_or]
    // payer = session ephemeral key
    // authority = current_holder wallet
    #[session(
           signer = signer,
           authority = game.current_holder.key()
       )]
    pub session_token: Option<Account<'info, SessionToken>>,

    /// CHECK: Pyth Lazer SOL price feed
    pub price_feed: AccountInfo<'info>,
}

#[session_auth_or(
    ctx.accounts.game.current_holder == ctx.accounts.signer.key(),
    SessionError::InvalidToken
)]
pub fn handler(ctx: Context<Pass>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    require!(game.status == GameStatus::Active, FlowError::GameNotActive);
    require!(
        ctx.accounts.signer.key() == game.current_holder || ctx.accounts.session_token.is_some(),
        FlowError::NotCurrentHolder
    );
    require!(
        ctx.accounts.signer.key() != ctx.accounts.next_player.wallet,
        FlowError::CannotPassToSelf
    );

    // Read FRESH Pyth price at exact moment of pass
    let fresh_price = read_price(&ctx.accounts.price_feed)?;

    // Calculate score for current holder
    let holder_player = &mut ctx.accounts.holder_player;

    let score = calculate_score(holder_player.price_at_receive, fresh_price, &game.direction);

    // Record score for current holder
    game.scores[holder_player.index as usize] = game.scores[holder_player.index as usize]
        .checked_add(score)
        .ok_or(FlowError::OverFlow)?;

    // pass to next player
    let next_player = &mut ctx.accounts.next_player;
    game.current_holder = next_player.wallet;
    next_player.price_at_receive = fresh_price;
    game.sol_price_now = fresh_price;

    msg!(
        "FLOW: Passed to {}. Score locked: {} bp. Price: {}",
        next_player.wallet,
        score,
        fresh_price
    );

    Ok(())
}

pub fn calculate_score(price_at_receive: i64, price_now: i64, direction: &Direction) -> i64 {
    if price_at_receive == 0 {
        return 0;
    }

    // basis points: 10000 = 100%, 100 = 1%, 1 = 0.01%
    let change_bp =
        ((price_now as i128 - price_at_receive as i128) * 10_000) / price_at_receive as i128;

    match direction {
        Direction::Long => change_bp as i64,   // earn on up
        Direction::Short => -change_bp as i64, // earn on down
    }
}
