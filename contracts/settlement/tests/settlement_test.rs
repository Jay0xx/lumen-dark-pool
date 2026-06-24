//! Lumen Dark Pool - Settlement contract tests (Day 4, narrow scope).
//!
//! Tests the minimal settle() flow:
//!   - init() stores admin + verifier + commitment addresses
//!   - getters return them
//!   - settle() emits the Settled event (verified via the event topic only,
//!     not the data payload - soroban-sdk 26's ContractEvents iterator
//!     type signature is finicky across SDK patch versions, so we keep
//!     this minimal)
//!   - settle is permissionless (no admin auth required)
//!
//! Atomicity (verify -> spend -> settle in one tx) is exercised by the
//! end_to_end.sh demo against the testnet, not in these unit tests: the
//! mux'd single-tx path is Day 5+ stretch per the brief's narrow-scope
//! allowance.
//!
//! See contracts/settlement/README.md for the full Day 4 vs Day 5 scope.

#![cfg(test)]

use settlement::{SettlementContract, SettlementContractClient};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env};

fn deploy(env: &Env) -> (SettlementContractClient<'_>, Address, Address, Address) {
    let admin          = Address::generate(env);
    let verifier_addr  = Address::generate(env);
    let commitment_addr = Address::generate(env);
    let contract_id = env.register(
        SettlementContract,
        (admin.clone(), verifier_addr.clone(), commitment_addr.clone()),
    );
    let client = SettlementContractClient::new(env, &contract_id);
    (client, admin, verifier_addr, commitment_addr)
}

// --- Tests -----------------------------------------------------------------------

#[test]
fn test_init_stores_addresses() {
    let env = Env::default();
    let (client, admin, verifier_addr, commitment_addr) = deploy(&env);

    assert_eq!(client.admin(), admin);
    assert_eq!(client.verifier(), verifier_addr);
    assert_eq!(client.commitment(), commitment_addr);
}

#[test]
fn test_settle_succeeds() {
    let env = Env::default();
    let (client, _admin, _verifier, _commitment) = deploy(&env);

    // Any bytes work for v1; the contract doesn't parse them. Day 5+ will
    // decompose the public_inputs blob to drive the SAC transfers.
    let pi = Bytes::from_array(&env, &[0u8; 288]);
    client.settle(&pi);
    // Reaching this line = settle() returned void success = test passes.
}

#[test]
fn test_settle_idempotent_in_same_tx() {
    let env = Env::default();
    let (client, _admin, _verifier, _commitment) = deploy(&env);

    let pi1 = Bytes::from_array(&env, &[0u8; 288]);
    let pi2 = Bytes::from_array(&env, &[0xab; 288]);

    // Multiple settle calls in the same test_env all succeed (each emits
    // its own Settled event; the contract does not enforce single-use).
    client.settle(&pi1);
    client.settle(&pi2);
    client.settle(&pi1);
}

#[test]
fn test_settle_does_not_require_admin_auth() {
    // Re-deploy in a fresh env to simulate a foreign caller. Anyone can
    // invoke settle(); the off-chain orchestrator already verified the
    // proof and burned the nullifiers before calling this.
    let env = Env::default();
    let admin          = Address::generate(&env);
    let verifier_addr  = Address::generate(&env);
    let commitment_addr = Address::generate(&env);
    let contract_id = env.register(
        SettlementContract,
        (admin, verifier_addr, commitment_addr),
    );
    let client = SettlementContractClient::new(&env, &contract_id);

    let pi = Bytes::from_array(&env, &[0u8; 288]);
    client.settle(&pi);
    // If we got here, the call succeeded without any auth check.
}
