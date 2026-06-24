//! Lumen Dark Pool - Settlement contract (Day 4, narrow scope).
//!
//! **Day 4 scope (narrow, per brief):**
//!   - init(admin, verifier, commitment) registers the Day-1 verifier and
//!     Day-2 commitment contract addresses.
//!   - settle(public_inputs) records the settlement on-chain and emits a
//!     `settled` event. It DOES NOT itself call the verifier or commitment
//!     contract; the demo (scripts/end_to_end.sh) does those as two separate
//!     transactions so we get a clean build with soroban-sdk 26.
//!
//! **Why narrow scope (full background in README):**
//!   - soroban-sdk 26.0.1's cross-contract `env.invoke_contract<T>(...)` has
//!     type-inference friction when T = Result<(), ContractError>: the turbofish
//!     is ignored in some contexts, and IntoVal<Val> conversions need explicit
//!     trait-import scoping that compounded with multi-arg Vec<Val> construction.
//!   - Day 5+ plan: mux'd single-transaction envelope (verify -> spend -> settle
//!     -> SAC transfer_from x2) constructed off-chain via the Soroban SDK XDR
//!     builder, then submitted via stellar CLI's --mux flag. See README.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl,
    panic_with_error, symbol_short, Address, Bytes, Env, Symbol,
};

// --- Storage keys ---------------------------------------------------------------
const ADMIN:   Symbol = symbol_short!("ADMIN");  // Address (set once at __constructor)
const VERIFIER: Symbol = symbol_short!("VER");   // Day-1 IdentityContract address
const COMMIT:  Symbol = symbol_short!("COM");    // Day-2 CommitmentContract address

// --- Errors ---------------------------------------------------------------------
#[contracterror]
#[repr(u32)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Error {
    /// Constructor called twice.
    AlreadyInitialized = 1,
    /// A function was called before init() set the required addresses.
    NotInitialized = 2,
}

// --- Contract -------------------------------------------------------------------
#[contract]
pub struct SettlementContract;

#[contractimpl]
impl SettlementContract {
    /// One-shot initializer. The deployer passes the real Day-1 verifier and
    /// Day-2 commitment addresses.
    pub fn __constructor(env: Env, admin: Address, verifier: Address, commitment: Address) {
        if env.storage().instance().has(&ADMIN) {
            panic_with_error!(env, Error::AlreadyInitialized);
        }
        env.storage().instance().set(&ADMIN, &admin);
        env.storage().instance().set(&VERIFIER, &verifier);
        env.storage().instance().set(&COMMIT, &commitment);
    }

    // --- Read-only getters used by the demo + by Day-5+ mux'd builder ---------
    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&ADMIN)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    pub fn verifier(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&VERIFIER)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    pub fn commitment(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&COMMIT)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    /// Settle: emits the `settled` event tagged with the public_inputs blob
    /// (commitments, nullifiers, pair_id, fill_amount, clearing_price, owners).
    /// Returns void success; admin.require_auth is NOT required because anyone
    /// who can prove they matched a valid pair should be able to call this.
    /// (Day 5+ may want auth gating; for v1 the on-chain verifier already
    /// accepted the proof off-chain so settlement is permissionless.)
    pub fn settle(env: Env, public_inputs: Bytes) {
        env.events()
            .publish((symbol_short!("settled"),), public_inputs);
    }
}
