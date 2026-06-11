use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PlayerAccount {
    pub game: Pubkey,
    pub wallet: Pubkey,
    pub index: u8,
    pub price_at_receive: i64, // price when they hold
    pub bump: u8,
}
