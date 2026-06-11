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

    use crate::instructions::{join_game, start_game};

    use super::*;

    pub fn create_game(
        ctx: Context<CreateGame>,
        direction: Direction,
        entry_fee: u64,
        loss_limit: u8,
        max_players: u8,
        ends_at: i64,
    ) -> Result<()> {
        create_game::handler(ctx, direction, entry_fee, loss_limit, max_players, ends_at)
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
}
