use crate::constants::*;
use crate::state::*;
use crate::utils::read_price;
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
};
use ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID;
use magicblock_magic_program_api::{args::ScheduleTaskArgs, instruction::MagicBlockInstruction};
// schedule_tick
// called ONCE on ER after delegate_game
// schedules tick_price to run every 100ms automatically

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct ScheduleTickArgs {
    pub task_id: i64,
    pub execution_interval_millis: i64,
    pub iterations: i64,
}

#[derive(Accounts)]
pub struct ScheduleTick<'info> {
    /// CHECK: used for CPI
    #[account()]
    pub magic_program: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Passed to CPI - using UncheckedAccount to avoid Anchor re-serializing stale data after CPI
    #[account(mut, seeds = [GAME_SEED,payer.key().as_ref()], bump)]
    pub game: UncheckedAccount<'info>,

    /// CHECK: current holder's PlayerAccount passed to tick_price
    pub holder_player: UncheckedAccount<'info>,

    /// CHECK: Pyth Lazer price feed passed to tick_price
    pub price_feed: UncheckedAccount<'info>,

    /// CHECK: used for CPI
    pub program: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct TickPrice<'info> {
    #[account(
        mut,
        seeds = [GAME_SEED, game_state.creator.as_ref()],
        bump  = game_state.bump,
    )]
    pub game_state: Account<'info, GameState>,

    // current holder's PlayerAccount
    // needed to check price_at_receive for loss limit
    #[account(
        seeds = [
            PLAYER_SEED,
            game_state.key().as_ref(),
            game_state.current_holder.as_ref()
        ],
        bump = holder_player.bump,
    )]
    pub holder_player: Account<'info, PlayerAccount>,

    /// CHECK: Pyth Lazer SOL/USD price feed
    pub price_feed: AccountInfo<'info>,
}

pub fn schedule_tick_handler(ctx: Context<ScheduleTick>, args: ScheduleTickArgs) -> Result<()> {
    // build the tick_price instruction to schedule
    let tick_ix = Instruction {
        program_id: crate::ID,
        accounts: vec![
            AccountMeta::new(ctx.accounts.game.key(), false),
            AccountMeta::new(ctx.accounts.holder_player.key(), false),
            AccountMeta::new_readonly(ctx.accounts.price_feed.key(), false),
        ],
        data: anchor_lang::InstructionData::data(&crate::instruction::TickPrice {}),
    };
    // serialize into MagicBlock ScheduleTask format

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

// tick_price
// called automatically by crank every 100ms
// updates price, checks loss limit + timer
pub fn tick_price_handler(ctx: Context<TickPrice>) -> Result<()> {
    let game = &mut ctx.accounts.game_state;

    // skip if already ended
    if game.status != GameStatus::Active {
        return Ok(());
    }

    // read fresh Pyth price
    let price = read_price(&ctx.accounts.price_feed)?;
    game.sol_price_now = price;

    // check timer
    let now = Clock::get()?.unix_timestamp;
    if now >= game.ends_at {
        game.status = GameStatus::Ended;
        game.final_price = price;
        msg!("FLOW: Timer expired. Game ended.");
        return Ok(());
    }

    // check loss limit for current holder
    let holder = &ctx.accounts.holder_player;
    if is_loss_limit_hit(
        holder.price_at_receive,
        price,
        game.loss_limit,
        &game.direction,
    ) {
        game.status = GameStatus::Ended;
        game.final_price = price;
        msg!("FLOW: Loss limit hit. Game ended.");
    }

    Ok(())
}

fn is_loss_limit_hit(
    price_at_receive: i64,
    price_now: i64,
    loss_limit: u8,
    direction: &Direction,
) -> bool {
    if price_at_receive == 0 {
        return false;
    }

    let change_bp =
        ((price_now as i128 - price_at_receive as i128) * 10_000) / price_at_receive as i128;

    // loss is direction dependent
    let loss_bp = match direction {
        Direction::Long => -change_bp, // long loses when price drops
        Direction::Short => change_bp, // short loses when price rises
    };

    let limit_bp = loss_limit as i128 * 100;
    loss_bp >= limit_bp
}
