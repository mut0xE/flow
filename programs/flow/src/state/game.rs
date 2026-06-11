use anchor_lang::prelude::*;

#[account]
pub struct GameState {
    //config
    pub creator: Pubkey,
    pub direction: Direction,
    pub entry_fee: u64,
    pub loss_limit: u8,
    pub max_players: u8,

    // players
    pub player_count: u8,
    pub yields: Vec<i64>,
    pub total_deposited: u64,

    // live state
    pub status: GameStatus,
    pub current_holder: Pubkey,

    pub start_price: i64,
    pub sol_price_now: i64,

    // timestamps
    pub created_at: i64,
    pub started_at: i64,
    pub ends_at: i64,

    pub bump: u8,
    pub vault_bump: u8,
}
impl GameState {
    pub const SPACE: usize = 8 // discriminator
        + 32            // creator
        + 1             // direction
        + 8             // entry_fee
        + 1             // loss_limit
        + 1             // max_players
        + 1             // player_count
        + 8             // total_deposited
        + (4 + 8 * 8)   // yields vec max 8
        + 1             // status
        + 32            // current_holder
        + 8             // start_price
        + 8             // sol_price_now
        + 8             // created_at
        + 8             // started_at
        + 8             // ends_at
        + 1 // bump
        + 1; // vault_bump
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum Direction {
    Long,
    Short,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum GameStatus {
    Waiting,
    Active,
    Ended,
    Settled,
}
