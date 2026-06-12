use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::system_program::Transfer;

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(mut)]
    pub player: Signer<'info>,

    #[account(
           mut,
           seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref() ,game.creator.as_ref()],
           bump  = game.bump,
       )]
    pub game: Account<'info, GameState>,

    /// vault system PDA — just holds SOL
    #[account(
          mut,
          seeds = [VAULT_SEED, game.key().as_ref()],
          bump  = game.vault_bump,
      )]
    pub vault: SystemAccount<'info>,

    #[account(
          init,
          payer = player,
          space = PlayerAccount::DISCRIMINATOR.len() + PlayerAccount::INIT_SPACE,
          seeds = [PLAYER_SEED, game.key().as_ref(), player.key().as_ref()],
          bump,
      )]
    pub player_account: Account<'info, PlayerAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<JoinGame>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    require!(
        game.status == GameStatus::Waiting,
        FlowError::GameNotWaiting
    );

    require!(game.player_count < game.max_players, FlowError::GameFull);

    let player_index = game.player_count;

    // Transfer entry fee to vault
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        game.entry_fee,
    )?;

    game.player_count = game
        .player_count
        .checked_add(1)
        .ok_or(FlowError::OverFlow)?;
    game.total_deposited = game
        .total_deposited
        .checked_add(game.entry_fee)
        .ok_or(FlowError::OverFlow)?;

    ctx.accounts.player_account.set_inner(PlayerAccount {
        game: game.key(),
        wallet: ctx.accounts.player.key(),
        index: player_index,
        price_at_receive: 0,
        bump: ctx.bumps.player_account,
    });

    msg!(
        "FLOW: Player {} joined. {}/{} players.",
        ctx.accounts.player.key(),
        game.player_count,
        game.max_players
    );

    Ok(())
}
