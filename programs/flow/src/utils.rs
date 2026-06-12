use crate::constants::MAX_PRICE_AGE;
use anchor_lang::prelude::*;
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;
pub fn read_price(price_feed: &AccountInfo) -> Result<i64> {
    // deserialize the PriceUpdateV2 from the account data
    let price_update =
        PriceUpdateV2::try_deserialize_unchecked(&mut (*price_feed.data.borrow()).as_ref())
            .map_err(Into::<Error>::into)?;

    // feed_id = the account address itself
    let feed_id: [u8; 32] = price_feed.key().to_bytes();

    let price = price_update
        .get_price_no_older_than(&Clock::get()?, MAX_PRICE_AGE, &feed_id)
        .map_err(Into::<Error>::into)?;

    Ok(price.price)
}
