use anchor_lang::prelude::*;

#[account]
#[derive(Debug)]
pub struct GameState {
    pub game_id: u64,
    pub creator: Pubkey,
    pub direction: Direction,
    pub entry_fee: u64,
    pub loss_limit: u8,
    pub max_players: u8,
    pub player_count: u8,
    pub players: Vec<Pubkey>,
    pub scores: Vec<i64>,
    pub total_deposited: u64,
    pub status: GameStatus,
    pub current_holder: Pubkey,
    pub final_price: i64,
    pub start_price: i64,
    pub sol_price_now: i64,
    pub created_at: i64,
    pub started_at: i64,
    pub ends_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
}
impl GameState {
    pub const SPACE: usize = 8 // discriminator
        + 8             // game id
        + 32            // creator
        + 1             // direction
        + 8             // entry_fee
        + 1             // loss_limit
        + 1             // max_players
        + 1             // player_count
        + (4 + 32 * 8)  // players vec max 8
        + 8             // total_deposited
        + (4 + 8 * 8)   // scores vec max 8
        + 1             // status
        + 32            // current_holder
        + 8             // final_price
        + 8             // start_price
        + 8             // sol_price_now
        + 8             // created_at
        + 8             // started_at
        + 8             // ends_at
        + 1 // bump
        + 1; // vault_bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum Direction {
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Debug)]
pub enum GameStatus {
    Waiting,
    Active,
    Ended,
    Settled,
}
