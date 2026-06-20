use crate::constants::*;
use crate::errors::FlowError;
use crate::instructions::calculate_score;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::cpi::DELEGATION_PROGRAM_ID;
use ephemeral_rollups_sdk::ephem::{CallHandler, FoldableIntentBuilder, MagicIntentBundleBuilder};
use ephemeral_rollups_sdk::{ActionArgs, ShortAccountMeta};

impl TryFrom<&AccountInfo<'_>> for PlayerAccount {
    type Error = Error;

    fn try_from(acc: &AccountInfo<'_>) -> Result<Self> {
        PlayerAccount::try_deserialize(&mut &acc.try_borrow_data()?[..])
            .map_err(|_| error!(FlowError::InvalidPlayer))
    }
}

#[commit]
#[derive(Accounts)]
pub struct CommitAndSettle<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref(), game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: Pyth price feed
    pub price_feed: AccountInfo<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, CommitAndSettle<'info>>) -> Result<()> {
    let game = &mut ctx.accounts.game;

    if game.status == GameStatus::Active {
        let now = Clock::get()?.unix_timestamp;
        if now >= game.ends_at {
            let final_price = read_price(&ctx.accounts.price_feed)?;
            game.status = GameStatus::Ended;
            game.final_price = final_price;
            game.sol_price_now = final_price;
            msg!("FLOW: Timer expired during commit_and_settle. Game ended.");
        }
    }

    require!(game.status == GameStatus::Ended, FlowError::GameNotEnded);

    let player_count = game.player_count as usize;
    require!(
        ctx.remaining_accounts.len() == player_count,
        FlowError::InvalidPlayerCount
    );

    let mut seen = vec![false; player_count];
    let mut players: Vec<(PlayerAccount, &AccountInfo)> = Vec::with_capacity(player_count);

    for acc in ctx.remaining_accounts.iter() {
        let player = PlayerAccount::try_from(acc)?;

        let (expected_pda, _) = Pubkey::find_program_address(
            &[PLAYER_SEED, game.key().as_ref(), player.wallet.as_ref()],
            &crate::ID,
        );
        require_keys_eq!(expected_pda, acc.key(), FlowError::InvalidPlayer);
        require!(
            (player.index as usize) < player_count,
            FlowError::InvalidPlayer
        );

        let idx = player.index as usize;
        require!(!seen[idx], FlowError::DuplicatePlayer);
        seen[idx] = true;
        msg!(
            "playerPDA[{}] pda={} wallet={} price_at_receive={}",
            idx,
            acc.key(),
            player.wallet,
            player.price_at_receive
        );
        players.push((player, acc));
    }
    require!(seen.iter().all(|&v| v), FlowError::MissingPlayer);

    let holder_key = game.current_holder;
    let (holder_player, _) = players
        .iter()
        .find(|(p, _)| p.wallet == holder_key)
        .ok_or(error!(FlowError::InvalidPlayer))?;

    let holder_idx = holder_player.index as usize;
    require!(holder_idx < player_count, FlowError::InvalidPlayer);

    msg!(
        "FLOW DEBUG: holder={} price_at_receive={} final_price={} direction={:?}",
        holder_key,
        holder_player.price_at_receive,
        game.final_price,
        game.direction
    );

    let final_score = calculate_score(
        holder_player.price_at_receive,
        game.final_price,
        &game.direction,
    );

    msg!(
        "FLOW DEBUG: prev_score={} final_score={} new_score={}",
        game.scores[holder_idx],
        final_score,
        game.scores[holder_idx]
            .checked_add(final_score)
            .unwrap_or(0)
    );

    game.scores[holder_idx] = game.scores[holder_idx]
        .checked_add(final_score)
        .ok_or(FlowError::OverFlow)?;

    msg!(
        "FLOW: final holder={} idx={} score={}",
        holder_key,
        holder_idx,
        game.scores[holder_idx]
    );

    game.status = GameStatus::Settled;

    let mut accounts_to_commit = vec![ctx.accounts.game.to_account_info()];

    for acc in ctx.remaining_accounts.iter() {
        accounts_to_commit.push(acc.clone());
    }

    ctx.accounts.game.exit(&crate::ID)?;

    let instruction_data = anchor_lang::InstructionData::data(&crate::instruction::Settle {});
    let action_args = ActionArgs::new(instruction_data);

    let vault_key =
        Pubkey::find_program_address(&[VAULT_SEED, ctx.accounts.game.key().as_ref()], &crate::ID).0;

    msg!(
        "COMMIT: building settle action — game={} vault={} treasury={}",
        ctx.accounts.game.key(),
        vault_key,
        TREASURY
    );

    let escrow_authority_key = ctx.accounts.signer.key();
    let escrow_pda = Pubkey::find_program_address(
        &[b"balance", escrow_authority_key.as_ref(), &[255u8]],
        &DELEGATION_PROGRAM_ID,
    )
    .0;

    let mut action_accounts = vec![
        ShortAccountMeta {
            pubkey: ctx.accounts.game.key().to_bytes().into(),
            is_writable: true,
        }, // [0] game → Settle.game
        ShortAccountMeta {
            pubkey: vault_key.to_bytes().into(),
            is_writable: true,
        }, // [1] vault → Settle.vault
        ShortAccountMeta {
            pubkey: TREASURY.to_bytes().into(),
            is_writable: true,
        }, // [2] treasury → Settle.treasury
        ShortAccountMeta {
            pubkey: anchor_lang::system_program::ID.to_bytes().into(),
            is_writable: false,
        }, // [3] system_program → Settle.system_program
        ShortAccountMeta {
            pubkey: escrow_authority_key.to_bytes().into(),
            is_writable: true,
        }, // [4] escrow_auth → Settle.escrow_auth (auto-added by #[action] macro)
        ShortAccountMeta {
            pubkey: escrow_pda.to_bytes().into(),
            is_writable: true,
        }, // [5] escrow → Settle.escrow (auto-added by #[action] macro)
    ];

    // Player wallets → Settle.remaining_accounts[0..player_count-1].
    for (i, wallet) in ctx.accounts.game.players.iter().enumerate() {
        msg!("COMMIT: settle remaining_accounts[{}]={}", i, wallet);
        action_accounts.push(ShortAccountMeta {
            pubkey: wallet.to_bytes().into(),
            is_writable: true,
        });
    }

    let settle_action = CallHandler {
        destination_program: crate::ID,
        accounts: action_accounts,
        args: action_args,
        escrow_authority: ctx.accounts.signer.to_account_info(),
        compute_units: 200_000,
    };

    MagicIntentBundleBuilder::new(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&accounts_to_commit)
    .add_post_commit_actions([settle_action])
    .build_and_invoke()?;

    msg!("FLOW: Game + PlayerPDAs committed to L1. Call settle() on L1 to distribute vault.");
    Ok(())
}
