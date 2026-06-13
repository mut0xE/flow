use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::system_program::Transfer;

#[derive(Accounts)]
#[instruction(game_id:u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer  = creator,
        space  = GameState::DISCRIMINATOR.len() + GameState::SPACE,
        seeds  = [GAME_SEED, game_id.to_le_bytes().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub game: Account<'info, GameState>,

    /// CHECK: vault holds SOL
    #[account(
        mut,
        seeds  = [VAULT_SEED, game.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    #[account(
        init,
        payer  = creator,
        space  = PlayerAccount::DISCRIMINATOR.len() + PlayerAccount::INIT_SPACE,
        seeds  = [PLAYER_SEED, game.key().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub player: Account<'info, PlayerAccount>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateGame>,
    game_id: u64,
    direction: Direction,
    entry_fee: u64,
    loss_limit: u8,
    max_players: u8,
    ends_at: i64,
) -> Result<()> {
    require!(entry_fee > 0, FlowError::InvalidEntryFee);
    require!(max_players >= MIN_PLAYERS, FlowError::InvalidEntryFee);
    require!(max_players <= MAX_PLAYERS, FlowError::GameFull);

    let now = Clock::get()?;
    require!(ends_at > now.unix_timestamp, FlowError::InvalidEntryFee);

    ctx.accounts.game.set_inner(GameState {
        game_id,
        creator: ctx.accounts.creator.key(),
        direction,
        entry_fee,
        loss_limit,
        max_players,
        player_count: 1,
        players: vec![ctx.accounts.creator.key()],
        scores: vec![0i64; max_players as usize],
        total_deposited: entry_fee,
        status: GameStatus::Waiting,
        current_holder: ctx.accounts.creator.key(),
        start_price: 0,
        sol_price_now: 0,
        created_at: now.unix_timestamp,
        started_at: 0,
        ends_at,
        bump: ctx.bumps.game,
        vault_bump: ctx.bumps.vault,
        final_price: 0,
    });

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.creator.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        entry_fee,
    )?;

    ctx.accounts.player.set_inner(PlayerAccount {
        game: ctx.accounts.game.key(),
        wallet: ctx.accounts.creator.key(),
        index: 0,
        price_at_receive: 0,
        bump: ctx.bumps.player,
    });

    msg!("FLOW: Game created.");

    Ok(())
}
