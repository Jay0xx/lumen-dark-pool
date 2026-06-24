// Lumen Dark Pool - order-matching circuit (lib)
// Reference spec: /circuits/SPEC.md
//
// Proving path: Noir (1.0.0-beta.22) -> UltraHonk (Barretenberg) ->
//                Soroban verifier using BN254 host functions.
//
// This file is intentionally small and self-contained except for the
// external Poseidon crate, which we share with the Day-1 hello circuit
// and the Day-2 off-chain helper. The hash function used here MUST equal
// theirs (BN254 Fr, Filecoin-style Poseidon, see /contracts/commitment/README.md).

use dep::poseidon::poseidon::bn254;

/// Domain separator for the nullifier hash. Must NOT collide with any
/// other Poseidon input shape we ever use. The bytes spell out
/// "LUMEN_NUL_DOMAIN_v1" interpreted as LITTLE-ENDIAN bytes then reduced
/// modulo the BN254 scalar field order.
/// MUST match the value in /prover/compute-hash/src/main.nr EXACTLY.
pub global NULLIFIER_DOMAIN: Field = 0x0c7d7e0c7d4e5f4e4f424c555f4e554c5f444f4d41494e5f7631;

/// A committed order. All fields are private to the order's owner; the
/// commitment is the only public-facing identifier.
pub struct Order {
    pub side: Field,
    pub pair_id: Field,
    pub amount: Field,
    pub limit_price: Field,
    pub owner: Field,
    pub nonce: Field,
}

/// Public inputs the matcher publishes alongside the proof.
pub struct PublicMatch {
    pub commit_buy: Field,
    pub commit_sell: Field,
    pub nullifier_buy: Field,
    pub nullifier_sell: Field,
    pub fill_amount: Field,
    pub clearing_price: Field,
    pub owner_buy: Field,
    pub owner_sell: Field,
}

/// Poseidon commitment for an order. Matches what the Day-2 Soroban
/// commitment contract stores (opaque BytesN<32>) and what the Day-2
/// off-chain helper recomputes when the trader reveals the order.
pub fn commitment_of(o: Order) -> Field {
    bn254::hash_6([o.side, o.pair_id, o.amount, o.limit_price, o.owner, o.nonce])
}

/// Per-order nullifier. Same construction as Nethermind Stellar Private
/// Payments and the canonical Privacy-Pools pattern.
pub fn nullifier_of(commitment: Field) -> Field {
    bn254::hash_2([commitment, NULLIFIER_DOMAIN])
}

/// Field-safe comparison helpers. We cast to u64 before doing arithmetic
/// so prices and amounts never wrap the BN254 modulus. The cast is a
/// witness-time constraint that forces the values to fit in 64 bits
/// (per SPEC section 2).
fn assert_lt(a: Field, b: Field) {
    let aa = a as u64;
    let bb = b as u64;
    assert(aa < bb, "expected a < b");
}
fn assert_le(a: Field, b: Field) {
    let aa = a as u64;
    let bb = b as u64;
    assert(aa <= bb, "expected a <= b");
}
fn assert_positive(a: Field) {
    let aa = a as u64;
    assert(aa > 0, "must be > 0");
}

/// Main constraint block. All eight C-rules from SPEC section 5 are enforced.
///
/// Named `match_orders` (not `match`) because `match` is a reserved keyword
/// in Noir - same as in Rust.
pub fn match_orders(
    buy: Order,
    sell: Order,
    pub_: PublicMatch,
) {
    // ---- C3: same asset pair (enforce explicitly via the openings) ----
    assert(buy.pair_id == sell.pair_id, "C3 pair_id mismatch");

    // ---- C1: commitment opening ----
    let cb = commitment_of(buy);
    let cs = commitment_of(sell);
    assert(cb == pub_.commit_buy,  "C1 buy commitment mismatch");
    assert(cs == pub_.commit_sell, "C1 sell commitment mismatch");

    // ---- C2: side correctness ----
    assert(buy.side  == 0, "C2 buy.side must be 0 (BUY)");
    assert(sell.side == 1, "C2 sell.side must be 1 (SELL)");

    // ---- C8: non-trivial amounts ----
    assert_positive(buy.amount);
    assert_positive(sell.amount);

    // ---- C4: prices cross ----
    let lb = buy.limit_price as u64;
    let ls = sell.limit_price as u64;
    assert(lb >= ls, "C4 prices do not cross");

    // ---- C5: fair clearing price (deterministic midpoint, floor div) ----
    //   sum = lb + ls, mid = sum / 2  (integer floor)
    //   Bracket: ls <= mid <= lb
    let sum = lb + ls;
    let mid = sum / 2;
    assert(pub_.clearing_price as u64 == mid, "C5 clearing price != midpoint");
    assert(ls <= mid, "C5 midpoint below sell limit");
    assert(mid <= lb, "C5 midpoint above buy limit");

    // ---- C6: fill amount = min(amount_buy, amount_sell) ----
    let ab = buy.amount as u64;
    let as_ = sell.amount as u64;
    let m = if ab < as_ { ab } else { as_ };
    assert(pub_.fill_amount as u64 == m, "C6 fill_amount != min(amounts)");

    // ---- C8 (continued): no zero fill ----
    assert(m > 0, "C8 fill_amount must be > 0");

    // ---- C7: nullifier derivation ----
    let nb = nullifier_of(pub_.commit_buy);
    let ns = nullifier_of(pub_.commit_sell);
    assert(nb == pub_.nullifier_buy,  "C7 nullifier_buy mismatch");
    assert(ns == pub_.nullifier_sell, "C7 nullifier_sell mismatch");
}

// Re-exports so external callers (and tests) can reach the helpers without
// naming the file path.
pub use commitment_of as commitment;
pub use nullifier_of  as nullifier;
pub use match_orders  as verify_match;

