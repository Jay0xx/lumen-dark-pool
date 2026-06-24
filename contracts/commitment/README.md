# Commitment Contract (Day 2)

The on-chain state layer of the Lumen Dark Pool. Stores `commitment`
hashes and `nullifier` burns for orders that will eventually be matched
by the Day-3 matcher circuit and settled by the Day-4 mux'd
`PathPaymentStrictSend` transaction.

The contract deliberately does **not** recompute Poseidon hashes on-chain —
it stores opaque `BytesN<32>` values and treats them as unique tokens.
Hashing happens off-chain (see `/prover/compute-hash`) and inside the
Day-3 circuit; the contract's job is only the store-and-burn bookkeeping.
This keeps the WASM at ~6 KB instead of bloating it by ~45 KB of Poseidon
round constants.

## Storage

| Key             | Type                          | Purpose                                                              |
| --------------- | ----------------------------- | -------------------------------------------------------------------- |
| `LIVE`          | `Map<BytesN<32>, ()>`         | Commitments that have been submitted but not yet been spent            |
| `SPENT`         | `Map<BytesN<32>, ()>`         | Nullifiers that have been burned by `spend`                            |
| `ADMIN`         | `Address`                     | Set once in `__constructor`; reserved for future admin ops            |
| `SETTLE`        | `Address`                     | Address authorized to call `spend`; Day 4 will point this at the verifier/coordinator contract |

`Set` is emulated via `Map<_, ()>` because `soroban-sdk 26.0.1` doesn't
expose a `Set` type. The `contains_key` check gives identical semantics.

## API

### `__constructor(env, admin: Address, settlement_auth: Address)`

One-shot init. Panics with `Error::AlreadyInitialized` on a second call.

### `commit(env, commitment: BytesN<32>) -> Result<(), Error>`

Inserts `commitment` into `LIVE`. Rejects with `Error::CommitmentAlreadyExists`
if it's already there. Emits event `committed(commitment)`.

### `is_committed(env, commitment: BytesN<32>) -> bool`

Read-only membership check against `LIVE`.

### `is_nullified(env, nullifier: BytesN<32>) -> bool`

Read-only membership check against `SPENT`.

### `spend(env, nullifier_buy: BytesN<32>, nullifier_sell: BytesN<32>, commit_buy: BytesN<32>, commit_sell: BytesN<32>) -> Result<(), Error>`

Atomic burn of both nullifiers; emits event
`matched(commit_buy, commit_sell, nullifier_buy, nullifier_sell)`.

Validates (in order, all-or-nothing):

1. `settlement_auth.require_auth()` (caller auth).
2. `commit_buy` is in `LIVE`.
3. `commit_sell` is in `LIVE`.
4. `nullifier_buy` is NOT in `SPENT`.
5. `nullifier_sell` is NOT in `SPENT`.

If any check fails the function returns the corresponding `Error` and the
host rolls back the entire tx. Both nullifier writes happen in a single
`storage().instance().set(&SPENT, &spent)` call so the two burns land
in one storage transaction.

### Errors

```rust
Error::AlreadyInitialized       = 1
Error::NotInitialized          = 2
Error::CommitmentAlreadyExists = 3
Error::CommitmentNotFound      = 4
Error::NullifierAlreadySpent   = 5
Error::Unauthorized            = 6   // (unused today; reserved for non-settlement_auth admin ops)
```

## Poseidon Parameter Compatibility

This contract does **not** call Poseidon itself, but the commitments and
nullifiers it stores must match what the off-chain helper and Day-3 matcher
circuit compute. Both use the Filecoin-style Poseidon shipped by
[`noir-lang/poseidon v0.2.0`](https://github.com/noir-lang/poseidon/tree/v0.2.0),
specifically:

| Setting                | Value (commitment hash) | Value (nullifier hash) |
| ---------------------- | ----------------------- | ---------------------- |
| Function               | `bn254::hash_6`         | `bn254::hash_2`         |
| State width `t`        | 7                       | 3                      |
| Full rounds `rf`       | 8                       | 8                      |
| Partial rounds `rp`    | 57                      | 57                     |
| S-box exponent `alpha` | 5                       | 5                      |
| PoseidonConfig         | `PoseidonConfig<7, 119, 819>` | `PoseidonConfig<3, 81, 285>` |
| Consts source          | `poseidon::bn254::consts::x5_7_config` | `poseidon::bn254::consts::x5_3_config` |

> **Note:** the project SPEC.md `circuits/SPEC.md §7` calls for the
> "BN254-X5" / EVM-friendly parameter set (rf=64, rp=204). The
> `noir-lang/poseidon v0.2.0` crate actually uses the Filecoin-style
> parameter set above. We chose Filecoin-style so that Day-3's
> `use dep::poseidon::poseidon::bn254::hash_6` produces identical
> commitments on-chain. Switching to BN254-X5 would require regenerating
> the constants and updating every helper that touches them. Filed as a
> Day-5+ consideration.

### NULLIFIER_DOMAIN

Hardcoded in `/prover/compute-hash/src/main.nr` as the BN254 scalar
field element with little-endian bytes of `"LUMEN_NUL_DOMAIN_v1"`
truncated to 31 bytes:

```
NULLIFIER_DOMAIN = 0x0c7d7e0c7d4e5f4e4f424c555f4e554c5f444f4d41494e5f7631
```

Derived by: take the 19 ASCII bytes of `"LUMEN_NUL_DOMAIN_v1"`, interpret
as a little-endian unsigned integer (first byte = LSB), reduce modulo
the BN254 scalar field order
`r = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001`.
The Day-3 matcher circuit MUST use the exact same constant in its
`hash_2([commitment, NULLIFIER_DOMAIN])` call.

## Build & Test

```bash
# Build the WASM (from the workspace root)
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/commitment.wasm

# Run the unit tests (in-process Soroban env, no network)
cargo test -p commitment --release
# -> 6 tests, all pass:
#    test_commit_stores_and_query
#    test_duplicate_commit_rejected
#    test_spend_succeeds_when_inputs_valid
#    test_spend_reverts_on_missing_commitment
#    test_spend_reverts_when_caller_not_settlement_auth
#    test_atomicity_and_spent_nullifier_reverts
```

## Deploy & Run the Demo

```bash
# One-command end-to-end on Stellar public testnet
bash scripts/commitment_demo.sh
```

Phases:

1. Build WASM.
2. Deploy to testnet with `__constructor(admin=alice, settlement_auth=alice)`.
3. Compute commitment + nullifier for two orders via `nargo execute`
   on `/prover/compute-hash`.
4. `commit(commit1)`, `commit(commit2)` on the contract.
5. `spend(null1, null2, commit1, commit2)` — emits `matched` event.
6. Re-run `spend` with the same nullifiers — must revert with
   `Error::NullifierAlreadySpent` (idempotency proof).

Last successful run (recorded for reproducibility):

```
contract : CCY2VIBPQ5PTPDSPJUWPWQJ4TDNPQ36CADVTT5NQTDB2RILIHHLOYQ5D
network  : Stellar public testnet
explorer : https://stellar.expert/explorer/testnet/contract/CCY2VIBPQ5PTPDSPJUWPWQJ4TDNPQ36CADVTT5NQTDB2RILIHHLOYQ5D
deploy tx: 62cdaf4036e7517e4137f24958c6fcbf2f7108b10cbc35ece41e3afb2f6aae64
events   : 2x "committed" + 1x "matched" + 1x re-spend reverted (Error #5)
```

## Architecture

```
┌──────────────────┐    ┌──────────────────────────┐    ┌──────────────────┐
│ Trader's client  │    │  Off-chain helper        │    │ Soroban chain    │
│ (Day 5 UI)       │    │  /prover/compute-hash/   │    │                  │
│                  │    │                          │    │ contracts/        │
│ 1. Pick order    │    │ nargo execute            │    │   commitment/    │
│ 2. Submit (c, n) ├────▶ Poseidon hash           │    │                  │
│    via wallet    │    │   c = hash_6(side,...)   │    │  commit(c)       │
│                  │    │   n = hash_2(c, DOMAIN)  │    │  spend(n1, n2,   │
│                  │    │                          │    │        c1, c2)    │
│                  │    │                          │    │                  │
│                  │    │                          │    │  SPENT_NULLIFIERS│
└──────────────────┘    └──────────────────────────┘    └──────────────────┘

Day 3 plugs in: the off-chain helper becomes a ZK-proving circuit;
the same commitments/nullifiers are emitted from the Day-3 match proof.
Day 4 plugs in: settlement_auth points at the verifier coordinator;
the matched event triggers the mux'd PathPaymentStrictSend settlement.
```

## What's NOT here (Day 3+)

- No batch matching (N orders per proof). Day 3+ adds the matcher
  circuit and re-points settlement_auth at the verifier.
- No Merkle tree. `LIVE_COMMITMENTS` is a flat `Map` for v1; bumping
  to a Merkle tree would let `spend` take a Merkle path instead of an
  exact commitment, which would compose better with the matcher proof.
- No `nullifier_set_size` cap or aging-out of spent nullifiers.
- No `Bump`/TTL management on the `LIVE`/`SPENT` instance storage.
  At scale this needs explicit bumping; Day 4+ should add a periodic
  bump funded by the same admin.
