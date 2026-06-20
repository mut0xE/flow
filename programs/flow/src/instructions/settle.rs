use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::action;

#[action]
#[derive(Accounts)]
pub struct Settle<'info> {
    /// CHECK: was delegated — PDA and data verified manually in handler
    #[account(mut)]
    pub game: UncheckedAccount<'info>,

    ///CHECK: vault was never delegated — safe to constrain normally
    #[account(
        mut,
        seeds = [VAULT_SEED, game.key().as_ref()],
        bump,
    )]
    pub vault: UncheckedAccount<'info>,

    /// CHECK: dust recipient
    #[account(mut, address = TREASURY @ FlowError::InvalidTreasury)]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
    let game_info = &mut ctx.accounts.game.to_account_info();
    let mut data: &[u8] = &game_info.try_borrow_data()?;
    let mut game = GameState::try_deserialize(&mut data)?;

    let (expected_pda, _) = Pubkey::find_program_address(
        &[
            GAME_SEED,
            game.game_id.to_le_bytes().as_ref(),
            game.creator.as_ref(),
        ],
        &crate::ID,
    );
    require_keys_eq!(
        expected_pda,
        ctx.accounts.game.key(),
        FlowError::InvalidPlayer
    );

    require!(ctx.accounts.vault.lamports() > 0, FlowError::AlreadySettled);
    require!(
        game.status == GameStatus::Ended || game.status == GameStatus::Settled,
        FlowError::GameNotEnded
    );

    let player_count = game.player_count as usize;
    require!(
        player_count > 0 && player_count <= MAX_PLAYERS as usize,
        FlowError::InvalidPlayerCount
    );
    require!(game.scores.len() >= player_count, FlowError::InvalidScores);
    require!(
        game.players.len() == player_count,
        FlowError::InvalidPlayerCount
    );

    require!(
        ctx.remaining_accounts.len() >= player_count,
        FlowError::InvalidPlayerCount
    );

    for i in 0..player_count {
        require_keys_eq!(
            ctx.remaining_accounts[i].key(),
            game.players[i],
            FlowError::InvalidPlayer
        );
    }

    let mut total_positive: i64 = 0;
    let mut max_neg_score: i64 = i64::MIN;
    let mut all_zero = true;

    for i in 0..player_count {
        let s = game.scores[i];
        if s > 0 {
            total_positive = total_positive.checked_add(s).ok_or(FlowError::OverFlow)?;
            all_zero = false;
        } else if s < 0 {
            all_zero = false;
            if s > max_neg_score {
                max_neg_score = s;
            }
        }
    }

    let tied_count: u64 = if !all_zero && total_positive == 0 {
        let mut count: u64 = 0;
        for i in 0..player_count {
            if game.scores[i] != 0 && game.scores[i] == max_neg_score {
                count = count.checked_add(1).ok_or(FlowError::OverFlow)?;
            }
        }
        require!(count > 0, FlowError::InvalidState);
        count
    } else {
        0
    };

    let total_pool = game.total_deposited;
    let game_key = ctx.accounts.game.key();
    let vault_bump = game.vault_bump;
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, game_key.as_ref(), &[vault_bump]];

    let mut total_paid: u64 = 0;

    for i in 0..player_count {
        let s = game.scores[i];
        let payout: u64 = if all_zero {
            total_pool / player_count as u64
        } else if total_positive > 0 {
            if s > 0 {
                ((s as u128) * (total_pool as u128) / (total_positive as u128)) as u64
            } else {
                0
            }
        } else {
            if s != 0 && s == max_neg_score {
                total_pool / tied_count
            } else {
                0
            }
        };

        if payout > 0 {
            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: ctx.remaining_accounts[i].clone(),
                    },
                    &[vault_seeds],
                ),
                payout,
            )?;
            total_paid = total_paid.checked_add(payout).ok_or(FlowError::OverFlow)?;
            msg!(
                "SETTLE: paid {} → {}",
                payout,
                ctx.remaining_accounts[i].key()
            );
        }
    }

    let dust = total_pool.saturating_sub(total_paid);
    if dust > 0 {
        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                },
                &[vault_seeds],
            ),
            dust,
        )?;
    }

    game.status = GameStatus::Settled;

    if ctx.accounts.game.owner == &crate::ID {
        game.try_serialize(&mut &mut ctx.accounts.game.try_borrow_mut_data()?[..])?;
    }

    msg!(
        "FLOW: settle complete total_paid={} dust={}",
        total_paid,
        dust
    );
    Ok(())
}
