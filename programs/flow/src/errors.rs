use anchor_lang::prelude::*;

#[error_code]
pub enum FlowError {
    #[msg("Game is not waiting for players")]
    GameNotWaiting,

    #[msg("Game is not active")]
    GameNotActive,

    #[msg("Game is full")]
    GameFull,

    #[msg("Game has not ended yet")]
    GameNotEnded,

    #[msg("You are not the current holder")]
    NotCurrentHolder,

    #[msg("Invalid player index")]
    InvalidPlayerIndex,

    #[msg("Player already joined")]
    AlreadyJoined,

    #[msg("Entry fee must be greater than zero")]
    InvalidEntryFee,

    #[msg("Vault has insufficient funds")]
    InsufficientFunds,

    #[msg("Could not read price feed")]
    InvalidPriceFeed,

    #[msg("Game is already settled")]
    AlreadySettled,

    #[msg("Timer has not expired yet")]
    TimerNotExpired,

    #[msg("OverFlow")]
    OverFlow,

    #[msg("Not all players have joined yet")]
    GameNotReady,

    #[msg("Cannot pass to yourself")]
    CannotPassToSelf,

    #[msg("Invalid player count in remaining accounts")]
    InvalidPlayerCount,

    #[msg("Invalid player account")]
    InvalidPlayer,

    #[msg("Duplicate player account")]
    DuplicatePlayer,

    #[msg("Missing player account")]
    MissingPlayer,

    #[msg("Invalid treasury account")]
    InvalidTreasury,

    #[msg("Scores length mismatch")]
    InvalidScores,

    #[msg("Invalid State")]
    InvalidState,
}
