use anchor_lang::prelude::*;
mod constants;
mod errors;
mod instructions;
mod state;
mod utils;
declare_id!("FxDoKzGEKbeorKGj1rCQukcCKLuKcYYrHD3S7x8Grwec");

use ephemeral_rollups_sdk::anchor::ephemeral;
use instructions::*;
use state::*;

#[ephemeral]
#[program]
pub mod flow {

    use super::*;

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        direction: Direction,
        entry_fee: u64,
        loss_limit: u8,
        max_players: u8,
        ends_at: i64,
    ) -> Result<()> {
        create_game::handler(
            ctx,
            game_id,
            direction,
            entry_fee,
            loss_limit,
            max_players,
            ends_at,
        )
    }

    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        join_game::handler(ctx)
    }

    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        start_game::handler(ctx)
    }

    pub fn delegate_account(ctx: Context<DelegateInput>, account_type: AccountType) -> Result<()> {
        delegate::delegate(ctx, account_type)
    }

    pub fn schedule_tick(
        ctx: Context<ScheduleTick>,
        game_id: u64,
        args: ScheduleTickArgs,
    ) -> Result<()> {
        tick_price::schedule_tick_handler(ctx, game_id, args)
    }

    pub fn tick_price(ctx: Context<TickPrice>) -> Result<()> {
        tick_price::tick_price_handler(ctx)
    }

    pub fn pass(ctx: Context<Pass>) -> Result<()> {
        pass::handler(ctx)
    }

    pub fn commit_and_settle<'info>(
        ctx: Context<'_, '_, 'info, 'info, CommitAndSettle<'info>>,
    ) -> Result<()> {
        commit_and_settle::handler(ctx)
    }

    pub fn settle<'info>(ctx: Context<'_, '_, 'info, 'info, Settle<'info>>) -> Result<()> {
        settle::handler(ctx)
    }
}
