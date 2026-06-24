//! Lumen Dark Pool - Order-commitment + nullifier-set contract (Day 2).
//!
//! On-chain state layer for the dark pool:
//!   - LIVE_COMMITMENTS: a Map<BytesN<32>, ()> of currently-live commitments.
//!   - SPENT_NULLIFIERS: a Map<BytesN<32>, ()> of nullifiers that have been burned.
//!     (soroban-sdk 26 has no `Set` type; we use Map<_, ()> as a set.)
//!   - ADMIN + SETTLEMENT_AUTH: addresses set once at construction.
//!
//! Public API:
//!   - __constructor(env, admin, settlement_auth): one-shot init.
//!   - commit(env, commitment) -> Result<(), Error>: insert a commitment; reject duplicates.
//!   - is_committed(env, commitment) -> bool: read-only membership check.
//!   - is_nullified(env, nullifier) -> bool: read-only nullifier check.
//!   - spend(env, nullifier_buy, nullifier_sell, commit_buy, commit_sell) -> Result<(), Error>:
//!       gated on SETTLEMENT_AUTH.require_auth(); rejects if any commitment is missing or any
//!       nullifier is already spent; otherwise marks BOTH nullifiers spent in a single
//!       storage write and emits a `matched` event. All-or-nothing: if any check fails,
//!       the function returns Err and the host rolls back the entire tx state.
//!
//! Day-2 scope: pure on-chain state. NO Poseidon recomputation here (would bloat WASM
//! by ~45KB of Filecoin-style round constants). The contract stores OPAQUE commitments
//! and nullifiers; the off-chain helper + Day-3 circuit compute them via
//! `noir-lang/poseidon v0.2.0 :: bn254 :: hash_6` / `hash_2`. Params are pinned in
//! /contracts/commitment/README.md.
//!
//! Day-4 will wire settlement_auth to the verifier contract (or to a coordinator
//! contract that calls the verifier).

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl,
    panic_with_error, symbol_short, Address, BytesN, Env, Map, Symbol,
};

// --- Storage keys (each contract instance keeps its own state) -----------------
const LIVE: Symbol = symbol_short!("LIVE");  // Map<BytesN<32>, ()>
const SPENT: Symbol = symbol_short!("SPENT"); // Map<BytesN<32>, ()> (SDK 26 has no Set type)
const ADMIN: Symbol = symbol_short!("ADMIN");
const SET_AUTH: Symbol = symbol_short!("SETTLE");

// --- Contract -------------------------------------------------------------------

#[contract]
pub struct CommitmentContract;

#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// Constructor was called more than once.
    AlreadyInitialized = 1,
    /// A function was called before init() set the required addresses.
    NotInitialized = 2,
    /// `commit` was called with a commitment already in LIVE_COMMITMENTS.
    CommitmentAlreadyExists = 3,
    /// `spend` was called with a commitment that is not in LIVE_COMMITMENTS.
    CommitmentNotFound = 4,
    /// `spend` was called with a nullifier that has already been burned.
    NullifierAlreadySpent = 5,
    /// `spend` was called by an address other than SETTLEMENT_AUTH.
    Unauthorized = 6,
}

#[contractimpl]
impl CommitmentContract {
    /// One-shot initializer. Stores admin and settlement_auth in instance storage.
    /// Panics if called twice (Soroban `__constructor` is enforced at the host level,
    /// but we double-check for clarity).
    pub fn __constructor(env: Env, admin: Address, settlement_auth: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic_with_error!(env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&SET_AUTH, &settlement_auth);
    }

    /// Insert a commitment. Emits `committed(commitment)` on success.
    pub fn commit(env: Env, commitment: BytesN<32>) -> Result<(), Error> {
        let mut live: Map<BytesN<32>, ()> = read_live(&env);
        if live.contains_key(commitment.clone()) {
            return Err(Error::CommitmentAlreadyExists);
        }
        live.set(commitment.clone(), ());
        env.storage().instance().set(&LIVE, &live);
        env.events()
            .publish((symbol_short!("committed"),), commitment);
        Ok(())
    }

    /// Read-only: is this commitment currently live?
    pub fn is_committed(env: Env, commitment: BytesN<32>) -> bool {
        let live: Map<BytesN<32>, ()> = read_live(&env);
        live.contains_key(commitment)
    }

    /// Read-only: has this nullifier been spent?
    pub fn is_nullified(env: Env, nullifier: BytesN<32>) -> bool {
        let spent: Map<BytesN<32>, ()> = read_spent(&env);
        spent.contains_key(nullifier)
    }

    /// Burn both nullifiers atomically; emit `matched(commit_buy, commit_sell,
    /// nullifier_buy, nullifier_sell)`. Caller must be SETTLEMENT_AUTH.
    ///
    /// Atomicity: we validate ALL preconditions before any storage write, so if
    /// any check fails the host rolls back the entire tx (including the auth check)
    /// and no state is mutated. We additionally make the nullifier-write a single
    /// `set(&SPENT, &spent)` so both burns land in one storage txn.
    pub fn spend(
        env: Env,
        nullifier_buy: BytesN<32>,
        nullifier_sell: BytesN<32>,
        commit_buy: BytesN<32>,
        commit_sell: BytesN<32>,
    ) -> Result<(), Error> {
        // 1) Auth gate
        let settlement_auth: Address = env
            .storage()
            .instance()
            .get(&SET_AUTH)
            .ok_or(Error::NotInitialized)?;
        settlement_auth.require_auth();

        // 2) Load (read-only) state
        let live: Map<BytesN<32>, ()> = read_live(&env);
        let mut spent: Map<BytesN<32>, ()> = read_spent(&env);

        // 3) Validate all preconditions BEFORE any write
        if !live.contains_key(commit_buy.clone()) {
            return Err(Error::CommitmentNotFound);
        }
        if !live.contains_key(commit_sell.clone()) {
            return Err(Error::CommitmentNotFound);
        }
        if spent.contains_key(nullifier_buy.clone()) {
            return Err(Error::NullifierAlreadySpent);
        }
        if spent.contains_key(nullifier_sell.clone()) {
            return Err(Error::NullifierAlreadySpent);
        }

        // 4) Atomic write: both burns land in the single set() call.
        spent.set(nullifier_buy.clone(), ());
        spent.set(nullifier_sell.clone(), ());
        env.storage().instance().set(&SPENT, &spent);

        // 5) Emit
        env.events().publish(
            (symbol_short!("matched"),),
            (commit_buy, commit_sell, nullifier_buy, nullifier_sell),
        );

        Ok(())
    }
}

// --- Storage helpers ------------------------------------------------------------
//
// Soroban's Map doesn't have a `Default::default()` on the host side and we can't
// construct an empty `Map` cheaply outside of a contract invocation, so each helper
// returns an empty Map if the storage key is unset. This means callers MUST treat
// `read_live` / `read_spent` results as fallible views: `contains_key` simply
// returns false on an empty collection, which is the right semantics for our use.

fn read_live(env: &Env) -> Map<BytesN<32>, ()> {
    env.storage()
        .instance()
        .get(&LIVE)
        .unwrap_or_else(|| Map::new(env))
}

fn read_spent(env: &Env) -> Map<BytesN<32>, ()> {
    env.storage()
        .instance()
        .get(&SPENT)
        .unwrap_or_else(|| Map::new(env))
}
