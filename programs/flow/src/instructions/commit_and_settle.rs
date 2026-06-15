use crate::constants::*;
use crate::errors::FlowError;
use crate::instructions::calculate_score;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::commit;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

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
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [GAME_SEED, game.game_id.to_le_bytes().as_ref(), game.creator.as_ref()],
        bump  = game.bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: Pyth price feed
    pub price_feed: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
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

    let mut accounts_to_commit = vec![ctx.accounts.game.to_account_info()];
    for acc in ctx.remaining_accounts.iter() {
        accounts_to_commit.push(acc.clone());
    }

    ctx.accounts.game.exit(&crate::ID)?;

    MagicIntentBundleBuilder::new(
        ctx.accounts.signer.to_account_info(),
        ctx.accounts.magic_context.to_account_info(),
        ctx.accounts.magic_program.to_account_info(),
    )
    .commit_and_undelegate(&accounts_to_commit)
    .build_and_invoke()?;

    msg!("FLOW: Game + PlayerPDAs committed to L1. Call settle() on L1 to distribute vault.");
    Ok(())
}
