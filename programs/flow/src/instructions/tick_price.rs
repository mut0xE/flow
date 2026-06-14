use crate::constants::*;
use crate::errors::FlowError;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleTickArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
}

#[derive(Accounts)]
#[instruction(game_id:u64)]
pub struct ScheduleTick<'info> {
    /// CHECK: magic program CPI target
    #[account()]
    pub magic_program: UncheckedAccount<'info>,

    /// session key or any signer — not used for seed derivation
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: game creator wallet — used for game PDA seed derivation only
    pub creator: UncheckedAccount<'info>,

    /// CHECK: UncheckedAccount prevents Anchor re-serializing stale data after CPI
    #[account(mut, seeds = [GAME_SEED, game_id.to_le_bytes().as_ref(), creator.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,

    /// CHECK: Pyth price feed
    pub price_feed: UncheckedAccount<'info>,

    /// CHECK: program CPI target
    pub program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TickPrice<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, game_state.game_id.to_le_bytes().as_ref(), game_state.creator.as_ref()],
        bump  = game_state.bump,
    )]
    pub game_state: Account<'info, GameState>,

    /// CHECK: Pyth price feed
    pub price_feed: AccountInfo<'info>,
}

pub fn schedule_tick_handler(
    ctx: Context<ScheduleTick>,
    _game_id: u64,
    args: ScheduleTickArgs,
) -> Result<()> {
    require_keys_eq!(
        SOL,
        ctx.accounts.price_feed.key(),
        FlowError::InvalidPriceFeed
    );
    let tick_ix = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.game.key(), false),
            AccountMeta::new_readonly(ctx.accounts.price_feed.key(), false),
        ],
        data: anchor_lang::InstructionData::data(&crate::instruction::TickPrice {}),
    };
    let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
        task_id: args.task_id,
        execution_interval_millis: args.execution_interval_millis,
        iterations: args.iterations,
        instructions: vec![tick_ix],
    }))
    .map_err(|_| {
        msg!("ERROR: failed to serialize schedule args");
        ProgramError::InvalidArgument
    })?;

    let schedule_ix = Instruction::new_with_bytes(
        MAGIC_PROGRAM_ID,
        &ix_data,
        vec![
            AccountMeta::new(ctx.accounts.payer.key(), true),
            AccountMeta::new(ctx.accounts.game.key(), false),
        ],
    );

    invoke_signed(
        &schedule_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.game.to_account_info(),
        ],
        &[],
    )?;

    msg!(
        "FLOW: Crank scheduled. {}ms interval. {} iterations.",
        args.execution_interval_millis,
        args.iterations
    );
    Ok(())
}

// runs every 100ms via MagicBlock crank; ends game on timer expiry
pub fn tick_price_handler(ctx: Context<TickPrice>) -> Result<()> {
    let game = &mut ctx.accounts.game_state;

    if game.status != GameStatus::Active {
        return Ok(());
    }

    let price = read_price(&ctx.accounts.price_feed)?;
    game.sol_price_now = price;

    let now = Clock::get()?.unix_timestamp;
    if now >= game.ends_at {
        game.status = GameStatus::Ended;
        game.final_price = price;
        msg!("FLOW: Timer expired. Game ended.");
    }

    Ok(())
}

pub fn is_loss_limit_hit(
    price_at_receive: i64,
    price_now: i64,
    loss_limit: u8,
    direction: &Direction,
) -> bool {
    if price_at_receive == 0 {
        return false;
    }

    let change_bp =
        ((price_now as i128 - price_at_receive as i128) * 1_000_000) / price_at_receive as i128;

    // positive loss_bp = moving against the direction
    let loss_bp = match direction {
        Direction::Long => -change_bp,
        Direction::Short => change_bp,
    };

    // 1% loss_limit maps to 10_000 micro-bp
    let limit_bp = loss_limit as i128 * 10_000;
    loss_bp >= limit_bp
}
