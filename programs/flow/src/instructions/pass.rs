use crate::constants::*;
use crate::errors::FlowError;
use crate::instructions::is_loss_limit_hit;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use session_keys::{session_auth_or, Session, SessionError, SessionTokenV2};

#[derive(Accounts, Session)]
pub struct Pass<'info> {
    pub signer: Signer<'info>,

    #[account(
           mut,
           seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref() ,game.creator.as_ref()],
           bump  = game.bump,
       )]
    pub game: Account<'info, GameState>,

    #[account(
           mut,
           seeds = [PLAYER_SEED, game.key().as_ref(), game.current_holder.as_ref()],
           bump  = holder_player.bump,
       )]
    pub holder_player: Account<'info, PlayerAccount>,

    #[account(
           mut,
           seeds = [PLAYER_SEED, game.key().as_ref(), next_player.wallet.as_ref()],
           bump  = next_player.bump,
       )]
    pub next_player: Account<'info, PlayerAccount>,

    #[session(
           signer = signer,
           authority = game.current_holder.key()
       )]
    pub session_token: Option<Account<'info, SessionTokenV2>>,

    /// CHECK: Pyth price feed
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
        ctx.accounts.holder_player.wallet == game.current_holder,
        FlowError::NotCurrentHolder
    );
    require!(
        ctx.accounts.signer.key() != ctx.accounts.next_player.wallet,
        FlowError::CannotPassToSelf
    );

    let fresh_price = read_price(&ctx.accounts.price_feed)?;
    let holder_player = &mut ctx.accounts.holder_player;

    msg!(
        "FLOW DEBUG: holder={} price_at_receive={} fresh_price={} direction={:?}",
        holder_player.wallet,
        holder_player.price_at_receive,
        fresh_price,
        game.direction
    );

    let score = calculate_score(holder_player.price_at_receive, fresh_price, &game.direction);

    msg!(
        "FLOW DEBUG: prev_score={} pass_score={} new_score={}",
        game.scores[holder_player.index as usize],
        score,
        game.scores[holder_player.index as usize]
            .checked_add(score)
            .unwrap_or(0)
    );

    game.scores[holder_player.index as usize] = game.scores[holder_player.index as usize]
        .checked_add(score)
        .ok_or(FlowError::OverFlow)?;

    // end game if holder hit their loss limit
    if is_loss_limit_hit(
        holder_player.price_at_receive,
        fresh_price,
        game.loss_limit,
        &game.direction,
    ) {
        game.status = GameStatus::Ended;
        game.final_price = fresh_price;
        msg!(
            "FLOW: Loss limit hit for {}. Game ended.",
            holder_player.wallet
        );
        return Ok(());
    }

    let next_player = &mut ctx.accounts.next_player;
    game.current_holder = next_player.wallet;
    next_player.price_at_receive = fresh_price;
    game.sol_price_now = fresh_price;

    msg!(
        "FLOW: Passed to {}. Score locked: {} micro-bp. Price: {}, signer:{}",
        next_player.wallet,
        score,
        fresh_price,
        ctx.accounts.signer.key()
    );

    Ok(())
}

pub fn calculate_score(price_at_receive: i64, price_now: i64, direction: &Direction) -> i64 {
    if price_at_receive == 0 {
        return 0;
    }

    // micro-bp precision: avoids rounding small moves to zero
    let change_bp =
        ((price_now as i128 - price_at_receive as i128) * 1_000_000) / price_at_receive as i128;

    match direction {
        Direction::Long => change_bp as i64,
        Direction::Short => -change_bp as i64,
    }
}
