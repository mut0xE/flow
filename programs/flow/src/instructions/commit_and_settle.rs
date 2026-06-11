use crate::constants::*;
use crate::errors::FlowError;
use crate::instructions::calculate_score;
use crate::state::*;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::{CallHandler, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

#[commit]
#[derive(Accounts)]
pub struct CommitAndSettle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    // GameState
    #[account(
        mut,
        seeds = [GAME_SEED, game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    // current holder's PlayerAccount
    #[account(
        seeds = [
            PLAYER_SEED,
            game.key().as_ref(),
            game.current_holder.as_ref()
        ],
        bump = holder_player.bump,
    )]
    pub holder_player: Account<'info, PlayerAccount>,

    /// CHECK: vault system PDA holding all entry fees
    #[account(
        mut,
        seeds = [VAULT_SEED, game.key().as_ref()],
        bump  = game.vault_bump,
    )]
    pub vault: SystemAccount<'info>,

    /// CHECK: Pyth Lazer SOL price feed
    pub price_feed: AccountInfo<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, CommitAndSettle<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    // Only callable when game is Ended
    require!(game.status == GameStatus::Ended, FlowError::GameNotEnded);

    require!(
        ctx.remaining_accounts.len() == game.player_count as usize,
        FlowError::InvalidPlayerCount
    );

    let holder_player = &ctx.accounts.holder_player;

    let final_score = calculate_score(
        holder_player.price_at_receive,
        game.final_price,
        &game.direction,
    );

    game.scores[holder_player.index as usize] = game.scores[holder_player.index as usize]
        .checked_add(final_score)
        .ok_or(FlowError::OverFlow)?;

    let mut action_accounts = vec![
        ShortAccountMeta {
            pubkey: game.key().to_bytes().into(),
            is_writable: true,
        },
        ShortAccountMeta {
            pubkey: ctx.accounts.vault.key().to_bytes().into(),
            is_writable: true,
        },
    ];

    for account_info in ctx.remaining_accounts.iter() {
        let player_account = Account::<PlayerAccount>::try_from(account_info)?;

        let (expected_pda, _) = Pubkey::find_program_address(
            &[
                PLAYER_SEED,
                game.key().as_ref(),
                player_account.wallet.as_ref(),
            ],
            &crate::ID,
        );

        require_keys_eq!(player_account.game, game.key(), FlowError::InvalidPlayer);

        require_keys_eq!(expected_pda, player_account.key(), FlowError::InvalidPlayer);

        require!(
            player_account.index < game.player_count,
            FlowError::InvalidPlayer
        );
        action_accounts.push(ShortAccountMeta {
            pubkey: account_info.key().to_bytes().into(),
            is_writable: true,
        });
    }

    game.exit(&crate::ID)?;

    // Build settle() Magic Action
    let instruction_data =
        anchor_lang::InstructionData::data(&crate::instruction::CommitAndSettle {});
    let action_args = ActionArgs::new(instruction_data);

    let action = CallHandler {
        destination_program: crate::ID,
        accounts: action_accounts,
        args: action_args,
        // payer covers the L1 transaction fee for settle()
        escrow_authority: ctx.accounts.payer.to_account_info(),
        compute_units: 400_000,
    };

    // Commit + Undelegate + Magic Action
    MagicIntentBundleBuilder::new(
        ctx.accounts.payer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
    .add_post_commit_actions([action])
    .build_and_invoke()?;

    msg!("FLOW: Committed and undelegated. Settle action fired.");

    Ok(())
}
