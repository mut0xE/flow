use anchor_lang::prelude::*;
mod constants;
mod errors;
mod instructions;
mod state;

declare_id!("7jDDWFYbst3eavUKbvDYh9HzYY1BgAHXaRGyrUS4owuG");

#[program]
pub mod flow {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
