use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::action;

#[action]
#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref(), game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: vault holding all entry fees
    #[account(
        mut,
        seeds = [VAULT_SEED, game.key().as_ref()],
        bump  = game.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: verified against TREASURY_PUBKEY constant
    #[account(
            mut,
            constraint = treasury.key() == TREASURY
                @ FlowError::InvalidTreasury
        )]
    pub treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    let player_count = game.player_count as usize;

    require!(game.status == GameStatus::Ended, FlowError::GameNotEnded);
    require!(
        player_count > 0 && player_count <= MAX_PLAYERS as usize,
        FlowError::InvalidPlayerCount
    );
    require!(
        ctx.remaining_accounts.len() == player_count * 2,
        FlowError::InvalidPlayerCount
    );
    require!(game.scores.len() == player_count, FlowError::InvalidScores);

    let mut seen: [bool; MAX_PLAYERS as usize] = [false; MAX_PLAYERS as usize];
    let mut scores: [i64; MAX_PLAYERS as usize] = [0; MAX_PLAYERS as usize];
    let mut wallet_infos: [Option<&AccountInfo<'info>>; MAX_PLAYERS as usize] =
        [None; MAX_PLAYERS as usize];

    let mut total_positive: i64 = 0;
    let mut max_neg_score: i64 = i64::MIN;
    let mut non_zero_count: u64 = 0;
    let mut all_zero: bool = true;

    for i in (0..ctx.remaining_accounts.len()).step_by(2) {
        let player_pda_info = &ctx.remaining_accounts[i];
        let wallet_info = &ctx.remaining_accounts[i + 1];

        let player_account = Account::<PlayerAccount>::try_from(player_pda_info)?;
        let idx = player_account.index as usize;

        require_keys_eq!(player_account.game, game.key(), FlowError::InvalidPlayer);
        require!(idx < player_count, FlowError::InvalidPlayer);
        require!(!seen[idx], FlowError::DuplicatePlayer);

        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                PLAYER_SEED,
                game.key().as_ref(),
                player_account.wallet.as_ref(),
            ],
            &crate::ID,
        );
        require_keys_eq!(
            expected_pda,
            player_pda_info.key(),
            FlowError::InvalidPlayer
        );
        require_keys_eq!(
            wallet_info.key(),
            player_account.wallet,
            FlowError::InvalidPlayer
        );

        let score = game.scores[idx];
        seen[idx] = true;
        scores[idx] = score;
        wallet_infos[idx] = Some(wallet_info);

        if score > 0 {
            total_positive = total_positive
                .checked_add(score)
                .ok_or(FlowError::OverFlow)?;
            all_zero = false;
        } else if score < 0 {
            all_zero = false;
            non_zero_count = non_zero_count.checked_add(1).ok_or(FlowError::OverFlow)?;

            if score > max_neg_score {
                max_neg_score = score;
            }
        }
    }

    // all slots filled
    for i in 0..player_count {
        require!(seen[i], FlowError::MissingPlayer);
    }

    let total_pool = game.total_deposited;

    let tied_count: u64 = if !all_zero && total_positive == 0 {
        let mut count: u64 = 0;
        for i in 0..player_count {
            if scores[i] != 0 && scores[i] == max_neg_score {
                count = count.checked_add(1).ok_or(FlowError::OverFlow)?;
            }
        }
        require!(count > 0, FlowError::InvalidState);
        count
    } else {
        0
    };

    let vault_bump = game.vault_bump;
    let game_key = game.key();
    let vault_seeds: &[&[u8]] = &[VAULT_SEED, game_key.as_ref(), &[vault_bump]];

    let mut total_paid: u64 = 0;

    for i in 0..player_count {
        let s = scores[i];

        let payout: u64 = if all_zero {
            // CASE 3: equal refund
            total_pool / player_count as u64
        } else if total_positive > 0 {
            // CASE 1: proportional positive split
            if s > 0 {
                ((s as u128) * (total_pool as u128) / (total_positive as u128)) as u64
            } else {
                0
            }
        } else {
            // CASE 2: tied negative winners split
            if s != 0 && s == max_neg_score {
                total_pool / tied_count
            } else {
                0
            }
        };

        if payout > 0 {
            let wallet_info = match wallet_infos[i] {
                Some(w) => w,
                None => return err!(FlowError::MissingPlayer),
            };

            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to: wallet_info.to_account_info(),
                    },
                    &[vault_seeds],
                ),
                payout,
            )?;

            total_paid = total_paid.checked_add(payout).ok_or(FlowError::OverFlow)?;

            msg!("FLOW: {}→{}", payout, wallet_info.key());
        }
    }

    // dust to treasury
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
        msg!("FLOW: dust{} to treasury", dust);
    }

    game.status = GameStatus::Settled;
    msg!("FLOW: settled paid={} dust={}", total_paid, dust);

    Ok(())
}
