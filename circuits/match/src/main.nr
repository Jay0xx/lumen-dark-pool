// Lumen Dark Pool - order-matching circuit (entry + tests)
//
// src/main.nr is the proving entry; `nargo execute` and `bb prove` start
// at `main`. Public inputs are tagged `pub`; private inputs are bare fields.
// Values are pulled from Prover.toml by `nargo` automatically.
//
// Test functions for the 8 SPEC section 6 scenarios (T1..T8) live in this same
// file (Noir 1.0.0-beta.22 does not auto-discover tests/ as modules for
// binary crates; the Day-1 hello circuit proved the in-binary-file convention
// works).

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
    // Day-4 add: trader identities for the settlement contract to look up.
    // These are the SAME Field values already committed via C1 (the 6-tuple
    // commitment hashes side, pair, amount, limit, owner, nonce). The settlement
    // contract uses them as opaque IDs and resolves the real Stellar address
    // via a register_owner() admin call.
    owner_buy:      pub Field,
    owner_sell:     pub Field,

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
        side:        side_b,
        pair_id,
        amount:      amount_b,
        limit_price: limit_b,
        owner:       owner_b,
        nonce:       nonce_b,
    };
    let sell = Order {
        side:        side_s,
        pair_id,
        amount:      amount_s,
        limit_price: limit_s,
        owner:       owner_s,
        nonce:       nonce_s,
    };
    let pub_ = PublicMatch {
        commit_buy,
        commit_sell,
        nullifier_buy,
        nullifier_sell,
        fill_amount,
        clearing_price,
        owner_buy,
        owner_sell,
    };

    verify_match(buy, sell, pub_);
}

// ============================================================================
//  Test suite - SPEC section 6 acceptance scenarios T1..T8
//
//  All hash values below were computed via the off-chain helper at
//  /prover/compute-hash (which uses the SAME dep::poseidon v0.2.0 +
//  NULLIFIER_DOMAIN as the match circuit), so a successful nargo execute
//  of these tests is the Day-3 PARITY CHECK spelled out in the brief.
// ============================================================================

fn t1_buy() -> Order {
    Order { side: 0, pair_id: 42, amount: 100, limit_price: 105, owner: 12345, nonce: 111 }
}

fn t1_sell() -> Order {
    Order { side: 1, pair_id: 42, amount: 80,  limit_price: 100, owner: 67890, nonce: 222 }
}

// T1 hash values + Day-4 owner fields.
fn t1_pub() -> PublicMatch {
    PublicMatch {
        commit_buy:     0x01a8c4b54f90824685f88f6343c41c561d0212a00541043216ea31813fa72dd4,
        commit_sell:    0x1350320eba82d6be77c7c635e34dcb26829c7cb84014029dc43f8d03884c61d6,
        nullifier_buy:  0x1528fcbff14698f100f9b0920365e4e8f69d2ae3888af83d2f880cdfb6256c5b,
        nullifier_sell: 0x2ca47e359cfec650996d73e05c7bea762e07506745ab0ed176022fa9cc4c6ec4,
        fill_amount:    80,
        clearing_price: 102,
        owner_buy:      12345,
        owner_sell:     67890,
    }
}

// T1: valid crossing pair (limit_buy 105 >= limit_sell 100). Should pass.
#[test]
fn test_t1_valid_crossing_pair() {
    verify_match(t1_buy(), t1_sell(), t1_pub());
}

// T2: non-crossing pair (limit_buy 100 < limit_sell 105). Should fail C4.
#[test(should_fail_with = "C4")]
fn test_t2_non_crossing_pair() {
    let buy = Order  { side: 0, pair_id: 42, amount: 100, limit_price: 100, owner: 12345, nonce: 111 };
    let sell = Order { side: 1, pair_id: 42, amount: 80,  limit_price: 105, owner: 67890, nonce: 222 };
    let pub_ = PublicMatch {
        commit_buy:     0x29a70173b896ea8284d2bb67236568c132206d11a5c505aaa6f27f08cf8d543a,
        commit_sell:    0x18619355ceb0ba7e576d2677ce7033e6a90cd20fb7386f01970be7e38ee84a31,
        nullifier_buy:  0x17b300b14ea97f6f485df6b802c3573ff56db9d496235a3283fd26bc3956d4f7,
        nullifier_sell: 0x2ca179a91bed7938a849484643c4265db8a790132efdedcd7c2e503492102644,
        fill_amount:    80,
        clearing_price: 102,
        owner_buy:      12345,
        owner_sell:     67890,
    };
    verify_match(buy, sell, pub_);
}

// T3: tampered fill_amount (not min(100, 80) = 80; using 79). Should fail C6.
#[test(should_fail_with = "C6")]
fn test_t3_tampered_fill_amount() {
    let mut pub_ = t1_pub();
    pub_.fill_amount = 79;
    verify_match(t1_buy(), t1_sell(), pub_);
}

// T4: tampered clearing_price (not midpoint(102); using 103). Should fail C5.
#[test(should_fail_with = "C5")]
fn test_t4_tampered_clearing_price() {
    let mut pub_ = t1_pub();
    pub_.clearing_price = 103;
    verify_match(t1_buy(), t1_sell(), pub_);
}

// T5: wrong nullifier_buy (not derived from commit_buy; using 0xdead). Should
// fail C7.
#[test(should_fail_with = "C7")]
fn test_t5_wrong_nullifier() {
    let mut pub_ = t1_pub();
    pub_.nullifier_buy = 0xdead;
    verify_match(t1_buy(), t1_sell(), pub_);
}

// T6: side swap (buy.side = 1). Re-computed buy commitment + nullifier for
// the side-flipped tuple. Sell side unchanged from T1. Should fail C2.
#[test(should_fail_with = "C2")]
fn test_t6_side_swap() {
    let buy = Order { side: 1, pair_id: 42, amount: 100, limit_price: 105, owner: 12345, nonce: 111 };
    let pub_ = PublicMatch {
        commit_buy:     0x0c4f1d261b3e3cbb7a6739f4dc46aeb6c78200f5dad721ec6df95e8acf9e651f,
        commit_sell:    t1_pub().commit_sell,
        nullifier_buy:  0x040ee6b5453e25a3c60b3d988e7955135a2873e721e0e1b056d61e48c51d047e,
        nullifier_sell: t1_pub().nullifier_sell,
        fill_amount:    80,
        clearing_price: 102,
        owner_buy:      12345,
        owner_sell:     67890,
    };
    verify_match(buy, t1_sell(), pub_);
}

// T7: wrong pair_id in opening (sell.pair_id = 99, buy.pair_id = 42). Re-
// computed sell commitment + nullifier for the pair-99 tuple. Should fail C3.
#[test(should_fail_with = "C3")]
fn test_t7_wrong_pair_id_in_opening() {
    let sell = Order { side: 1, pair_id: 99, amount: 80, limit_price: 100, owner: 67890, nonce: 222 };
    let pub_ = PublicMatch {
        commit_buy:     t1_pub().commit_buy,
        commit_sell:    0x2f5238fe5807c6eee02e420d4bacd749f1c3833b6b57773c7c784c03cd2e0f10,
        nullifier_buy:  t1_pub().nullifier_buy,
        nullifier_sell: 0x011b50ef40f52c73202097631a22df7ed363f84116f58b081ebde5bd6bd8b33f,
        fill_amount:    80,
        clearing_price: 102,
        owner_buy:      12345,
        owner_sell:     67890,
    };
    verify_match(t1_buy(), sell, pub_);
}

// T8: zero-amount order (buy.amount = 0). Should fail assert_positive.
#[test(should_fail_with = "must be > 0")]
fn test_t8_zero_amount() {
    let buy = Order { side: 0, pair_id: 42, amount: 0, limit_price: 105, owner: 12345, nonce: 111 };
    let pub_ = PublicMatch {
        commit_buy:     0x1987aac84641a501bf6bfe6ad3ccee931dbef25238fc05fdbcdc5d3901394e37,
        commit_sell:    t1_pub().commit_sell,
        nullifier_buy:  0x2331b066499f6a651b07ae978f44ae7054f21844212b2c12f10d87e2f66adc73,
        nullifier_sell: t1_pub().nullifier_sell,
        fill_amount:    80,
        clearing_price: 102,
        owner_buy:      12345,
        owner_sell:     67890,
    };
    verify_match(buy, t1_sell(), pub_);
}
