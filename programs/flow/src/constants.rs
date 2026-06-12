use magicblock_magic_program_api::{pubkey, Pubkey};

pub const GAME_SEED: &[u8] = b"game";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PLAYER_SEED: &'static [u8] = b"player";

pub const MAX_PLAYERS: u8 = 8;
pub const MIN_PLAYERS: u8 = 2;
pub const MAX_PRICE_AGE: u64 = 60;

pub const TREASURY: Pubkey = pubkey!("mtqK4nCocC1A7K13oMxqcRY8DPbqAbVwmg7iCY5NvQU");
pub const SOL: Pubkey = pubkey!("ENYwebBThHzmzwPLAQvCucUTsjyfBSZdD9ViXksS4jPu");
