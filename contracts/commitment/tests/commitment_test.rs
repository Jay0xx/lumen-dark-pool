//! Tests for the commitment + nullifier contract (Day 2).
//!
//! These tests are intentionally Poseidon-agnostic: they use opaque 32-byte values
//! for commitments and nullifiers. The contract doesn't care HOW the commitment
//! was computed, only that it's a unique 32-byte token. Poseidon hashing is
//! covered by the off-chain helper + Day-3 circuit (see /prover/compute-hash and
//! /circuits/match).
//!
//! Tests:
//!   - commit stores a commitment
//!   - duplicate commit is rejected (state unchanged)
//!   - is_committed / is_nullified return correct values pre/post
//!   - spend succeeds when both commitments live + both nullifiers unspent
//!   - spend reverts if either commitment is not in LIVE_COMMITMENTS
//!   - spend reverts if caller != SETTLEMENT_AUTH
//!   - atomicity + nullifier-already-spent: a reverting spend leaves BOTH nullifiers
//!     unspent (covers both the atomicity regression and the "spent nullifier
//!     reverts" cases in one combined test)

#![cfg(test)]

use commitment::{CommitmentContract, CommitmentContractClient, Error};
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

// --- Test fixtures ---------------------------------------------------------------

const COMMIT_BUY:  [u8; 32] = [0x01; 32];
const COMMIT_SELL: [u8; 32] = [0x02; 32];
const NULL_BUY:    [u8; 32] = [0x03; 32];
const NULL_SELL:   [u8; 32] = [0x04; 32];
const NULL_OTHER:  [u8; 32] = [0x05; 32];
const COMMIT_X:    [u8; 32] = [0x10; 32];
const COMMIT_Y:    [u8; 32] = [0x11; 32];
const COMMIT_Z:    [u8; 32] = [0x20; 32];
const COMMIT_W:    [u8; 32] = [0x21; 32];

// `BytesN::from_array` requires &Env, so the helper threads it through.
fn b32(env: &Env, bytes: [u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, &bytes)
}

// Helper: deploy the contract with __constructor(admin, settlement_auth) and return
// the client + admin + settlement_auth addresses. Auto-mocks auths.
fn deploy(env: &Env) -> (CommitmentContractClient<'_>, Address, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let settlement_auth = Address::generate(env);
    let contract_id = env.register(CommitmentContract, (admin.clone(), settlement_auth.clone()));
    let client = CommitmentContractClient::new(env, &contract_id);
    (client, admin, settlement_auth)
}

// --- Tests -----------------------------------------------------------------------

#[test]
fn test_commit_stores_and_query() {
    let env = Env::default();
    let (client, _admin, _auth) = deploy(&env);

    let c = b32(&env, COMMIT_BUY);
    assert!(!client.is_committed(&c));
    assert!(!client.is_nullified(&b32(&env, NULL_BUY)));

    client.commit(&c);
    assert!(client.is_committed(&c));
    // Unrelated nullifier still unspent.
    assert!(!client.is_nullified(&b32(&env, NULL_BUY)));
}

#[test]
fn test_duplicate_commit_rejected() {
    let env = Env::default();
    let (client, _admin, _auth) = deploy(&env);

    let c = b32(&env, COMMIT_BUY);
    client.commit(&c);
    assert!(client.is_committed(&c));

    let result = client.try_commit(&c);
    assert_eq!(result, Err(Ok(Error::CommitmentAlreadyExists)));
    assert!(client.is_committed(&c));
}

#[test]
fn test_spend_succeeds_when_inputs_valid() {
    let env = Env::default();
    let (client, _admin, _auth) = deploy(&env);

    let cb = b32(&env, COMMIT_BUY);
    let cs = b32(&env, COMMIT_SELL);
    let nb = b32(&env, NULL_BUY);
    let ns = b32(&env, NULL_SELL);

    client.commit(&cb);
    client.commit(&cs);
    assert!(client.is_committed(&cb));
    assert!(client.is_committed(&cs));

    // spend() requires settlement_auth.require_auth(); with mock_all_auths this passes.
    client.spend(&nb, &ns, &cb, &cs);

    assert!(client.is_nullified(&nb));
    assert!(client.is_nullified(&ns));
    // Commitments stay live; aging-out is Day-3+ work.
    assert!(client.is_committed(&cb));
    assert!(client.is_committed(&cs));
}

#[test]
fn test_spend_reverts_on_missing_commitment() {
    let env = Env::default();
    let (client, _admin, _auth) = deploy(&env);

    let cb = b32(&env, COMMIT_BUY);
    let cs = b32(&env, COMMIT_SELL);
    let nb = b32(&env, NULL_BUY);
    let ns = b32(&env, NULL_SELL);

    // Only commit the buy side; sell side is missing.
    client.commit(&cb);

    let result = client.try_spend(&nb, &ns, &cb, &cs);
    assert_eq!(result, Err(Ok(Error::CommitmentNotFound)));
    assert!(!client.is_nullified(&nb));
    assert!(!client.is_nullified(&ns));
}

#[test]
fn test_spend_reverts_when_caller_not_settlement_auth() {
    // No mock_all_auths here - the settlement_auth.require_auth() should fail
    // because nobody signed for it.
    let env = Env::default();
    let admin = Address::generate(&env);
    let settlement_auth = Address::generate(&env);
    let contract_id = env.register(CommitmentContract, (admin, settlement_auth));
    let client = CommitmentContractClient::new(&env, &contract_id);

    let cb = b32(&env, COMMIT_BUY);
    let cs = b32(&env, COMMIT_SELL);
    let nb = b32(&env, NULL_BUY);
    let ns = b32(&env, NULL_SELL);

    // Anyone can commit (no auth required).
    client.commit(&cb);
    client.commit(&cs);

    // spend should fail without settlement_auth auth.
    let result = client.try_spend(&nb, &ns, &cb, &cs);
    assert!(result.is_err(), "spend should fail without settlement_auth auth");

    // Neither nullifier got burned.
    assert!(!client.is_nullified(&nb));
    assert!(!client.is_nullified(&ns));
}

#[test]
fn test_atomicity_and_spent_nullifier_reverts() {
    // Combined regression test:
    //   - burns nb via a first match
    //   - commits fresh commitments cb/cs
    //   - attempts a SECOND spend that includes the burned nb
    //   - asserts the contract reverts with NullifierAlreadySpent
    //   - asserts the SECOND nullifier was NOT burned (atomicity: host rolls back
    //     the entire tx)
    let env = Env::default();
    let (client, _admin, _auth) = deploy(&env);

    let cb = b32(&env, COMMIT_BUY);
    let cs = b32(&env, COMMIT_SELL);
    let nb = b32(&env, NULL_BUY);
    let no = b32(&env, NULL_OTHER);

    client.commit(&cb);
    client.commit(&cs);

    // Pre-burn nb via an unrelated match.
    let cb_pre = b32(&env, COMMIT_X);
    let cs_pre = b32(&env, COMMIT_Y);
    client.commit(&cb_pre);
    client.commit(&cs_pre);
    client.spend(&nb, &no, &cb, &cs_pre);

    assert!(client.is_nullified(&nb));
    assert!(client.is_nullified(&no));
    assert!(!client.is_nullified(&b32(&env, NULL_SELL)));

    // Now attempt a spend that includes the burned nb. Use a FRESH ns so we can
    // validly assert it's still unspent after the revert.
    let ns_fresh = b32(&env, NULL_SELL);
    let result = client.try_spend(&nb, &ns_fresh, &cb_pre, &cs);
    assert_eq!(result, Err(Ok(Error::NullifierAlreadySpent)));
    // Atomicity: ns_fresh must NOT have been burned.
    assert!(!client.is_nullified(&ns_fresh));
    // nb was already burned (still burned).
    assert!(client.is_nullified(&nb));
}
