use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{anchor::delegate, cpi::DelegateConfig};

use crate::constants::GAME_SEED;

#[delegate]
#[derive(Accounts)]
pub struct DelegateInput<'info> {
    pub payer: Signer<'info>,

    /// CHECK: The pda to delegate
    #[account(mut, del)]
    pub pda: AccountInfo<'info>,

    /// CHECK: Checked by the delegate program
    pub validator: Option<AccountInfo<'info>>,
}

pub fn delegate(ctx: Context<DelegateInput>, account_type: AccountType) -> Result<()> {
    let seeds = derive_seeds_from_account_type(&account_type);
    let seeds_refs: Vec<&[u8]> = seeds.iter().map(|s| s.as_slice()).collect();
    let validator = ctx.accounts.validator.as_ref().map(|v| v.key());

    ctx.accounts.delegate_pda(
        &ctx.accounts.payer,
        &seeds_refs,
        DelegateConfig {
            validator: validator,
            ..Default::default()
        },
    )?;
    Ok(())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum AccountType {
    GameState { game_id: u64, creator: Pubkey },
}

pub fn derive_seeds_from_account_type(account_type: &AccountType) -> Vec<Vec<u8>> {
    match account_type {
        AccountType::GameState { game_id, creator } => {
            vec![
                GAME_SEED.to_vec(),
                game_id.to_le_bytes().to_vec(),
                creator.as_ref().to_vec(),
            ]
        }
    }
}
