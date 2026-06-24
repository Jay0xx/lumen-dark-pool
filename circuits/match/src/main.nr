// Lumen Dark Pool — order-matching circuit (entry)
//
// src/main.nr is the proving entry; `nargo execute` and `bb prove` start
// here. Public inputs are tagged `pub`; private inputs are bare fields.
// Values are pulled from Prover.toml by `nargo` automatically.

mod lib;

use crate::lib::{Order, PublicMatch, match_orders as verify_match};

fn main(
    // ----- public inputs (also see PublicMatch) -----
    commit_buy:     pub Field,
    commit_sell:    pub Field,
    nullifier_buy:  pub Field,
    nullifier_sell: pub Field,
    pair_id:        pub Field,
    fill_amount:    pub Field,
    clearing_price: pub Field,

    // ----- private witness: buy order -----
    side_b:   Field,
    amount_b: Field,
    limit_b:  Field,
    owner_b:  Field,
    nonce_b:  Field,

    // ----- private witness: sell order -----
    side_s:   Field,
    amount_s: Field,
    limit_s:  Field,
    owner_s:  Field,
    nonce_s:  Field,
) {
    let buy = Order {
        side:       side_b,
        pair_id,
        amount:     amount_b,
        limit_price: limit_b,
        owner:      owner_b,
        nonce:      nonce_b,
    };
    let sell = Order {
        side:       side_s,
        pair_id,
        amount:     amount_s,
        limit_price: limit_s,
        owner:      owner_s,
        nonce:      nonce_s,
    };
    let pub_ = PublicMatch {
        commit_buy,
        commit_sell,
        nullifier_buy,
        nullifier_sell,
        fill_amount,
        clearing_price,
    };

    verify_match(buy, sell, pub_);
}
