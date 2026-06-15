use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use anchor_lang::prelude::*;

// Called on L1 when a game expired in Waiting status (never started).
// Refunds all joined players their entry fee and marks the game Settled.
#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref(), game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    #[account(
        mut,
        seeds = [VAULT_SEED, game.key().as_ref()],
        bump  = game.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, CancelGame<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    require!(game.status == GameStatus::Waiting, FlowError::GameNotWaiting);

    let now = Clock::get()?.unix_timestamp;
    require!(now >= game.ends_at, FlowError::TimerNotExpired);

    let player_count = game.player_count as usize;
    require!(
        ctx.remaining_accounts.len() == player_count,
        FlowError::InvalidPlayerCount
    );

    // Validate wallet order matches game.players
    for i in 0..player_count {
        require_keys_eq!(
            ctx.remaining_accounts[i].key(),
            game.players[i],
            FlowError::InvalidPlayer
        );
    }

    let game_key = game.key();
    let vault_bump = game.vault_bump;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, game_key.as_ref(), &[vault_bump]];

    // Refund each player their entry fee
    let refund = game.entry_fee;
    for i in 0..player_count {
        if refund > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.remaining_accounts[i].clone(),
                    },
                    &[vault_seeds],
                ),
                refund,
            )?;
            msg!("CANCEL: refunded {} → {}", refund, ctx.remaining_accounts[i].key());
        }
    }

    game.status = GameStatus::Settled;
    msg!("FLOW: cancel_game complete — {} players refunded", player_count);
    Ok(())
}
