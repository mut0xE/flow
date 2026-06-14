use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct StartGame<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref(), game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    #[account(
        mut,
        seeds = [PLAYER_SEED, game.key().as_ref(), game.creator.as_ref()],
        bump  = creator_player.bump,
    )]
    pub creator_player: Account<'info, PlayerAccount>,

    /// CHECK: Pyth Lazer SOL price feed
    pub price_feed: AccountInfo<'info>,
}

pub fn handler(ctx: Context<StartGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    require!(
        game.status == GameStatus::Waiting,
        FlowError::GameNotWaiting
    );

    require!(
        game.player_count == game.max_players,
        FlowError::GameNotReady
    );

    let price = read_price(&ctx.accounts.price_feed)?;
    let clock = Clock::get()?;

    game.start_price = price;
    game.started_at = clock.unix_timestamp;
    game.sol_price_now = price;
    game.status = GameStatus::Active;
    game.current_holder = game.creator;

    let creator_player = &mut ctx.accounts.creator_player;
    creator_player.price_at_receive = price;

    msg!(
        "FLOW: Game started. Price: {}. Holder: {}",
        price,
        game.current_holder
    );

    Ok(())
}
