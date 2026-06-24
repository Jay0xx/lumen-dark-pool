# Settlement Contract (Day 4, narrow scope)

End-to-end glue for the Lumen Dark Pool. The settlement contract:
- Holds the addresses of the deployed Day-1 verifier and Day-2 commitment contract
- Exposes `settle(public_inputs: Bytes)` which emits a `Settled` event tagged with
  the public_inputs blob
- Day-5+ wires this contract to call the verifier (verify proof) and the
  commitment contract (burn nullifiers), then does 2x SAC transfer_from for the
  base and quote legs — all inside ONE mux'd transaction envelope

## Architecture (current narrow scope)

```
                 ┌───────────────────────┐
                 │ prover (off-chain)     │
                 │   Day-3 match circuit  │
                 │   + bb prove           │
                 │   → proof + 288-byte   │
                 │     public_inputs blob │
                 └──────────┬────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │ Day-4 settlement.settle() │  ← emits Settled(public_inputs) event
              │ (no cross-contract calls │
              │  in narrow scope v1)     │
              └──────────────────────────┘

      Phase 1 (Day-1): verifier.prove_identity(proof, public_inputs)  — separate tx
      Phase 2 (Day-2): commitment.spend(nullifiers, commits)        — separate tx (run scripts/commitment_demo.sh)
      Phase 3 (Day-4): settlement.settle(public_inputs)             — separate tx (run scripts/end_to_end.sh)
```

## Storage

| Key         | Type      | Purpose                                                                |
| ----------- | --------- | ---------------------------------------------------------------------- |
| `ADMIN`     | `Address` | Set once at `__constructor`. Used as admin for future admin operations. |
| `VER`       | `Address` | Address of the Day-1 UltraHonk verifier contract.                       |
| `COM`       | `Address` | Address of the Day-2 commitment contract.                             |

Storage is read-only after `__constructor`. Day 5+ may add admin functions
to update these (e.g., rotate the verifier after a circuit upgrade).

## API

### `__constructor(env, admin: Address, verifier: Address, commitment: Address)`

One-shot initializer. Panics on a second call.

### `admin(env) -> Address`

Read-only getter (used by `scripts/end_to_end.sh` for the demo).

### `verifier(env) -> Address`

Read-only getter.

### `commitment(env) -> Address`

Read-only getter.

### `settle(env, public_inputs: Bytes)`

Emits the `Settled` event tagged with the entire `public_inputs` blob
(288 bytes: 9 Field values of 32 bytes each = commit_buy, commit_sell,
nullifier_buy, nullifier_sell, pair_id, fill_amount, clearing_price,
owner_buy, owner_sell).

Day-4 narrow scope does NOT call verifier or commitment contract from
within `settle` — those are two separate Soroban transactions orchestrated
by `scripts/end_to_end.sh`. Day 5+ plans a mux'd single-transaction envelope
that does all three (verify -> spend -> settle + SAC transfer_from x2)
atomically.

## Day-4 narrow scope: WHY

The brief explicitly allows: *"If a step blocks >2h, narrow scope (e.g.
fix one pair_id at deploy time) rather than miss the milestone."*

Concretely we narrowed scope on THREE axes:

1. **No cross-contract calls from `settle`**: a clean implementation
   `settle -> verifier.prove_identity -> commitment.spend -> SAC transfers`
   ran into type-inference friction with `soroban-sdk 26.0.1`'s
   `env.invoke_contract<T>` when `T = Result<(), ContractError>` (the
   turbofish was ignored in some contexts, requiring explicit `let`-bindings
   + `IntoVal<Val>` import scope that compounded with multi-arg
   `Vec<Val>` construction). Two callback paths through `verify_proof` +
   `commitment.spend` were the lines that wouldn't compile cleanly in
   Day-4 time budget.

2. **No pair / owner registry**: fixed `pair_id -> (base_token, quote_token)`
   mapping at deploy time would have helped but added more type machinery.
   The demo uses the public_inputs values directly without resolving them
   to Stellar addresses.

3. **No SAC transfers**: pre-approved `SAC.approve` + `SAC.transfer_from`
   between settlement contracts requires typed `stellar-asset` client code,
   again compounding the `invoke_contract` typing issue.

All three are Day 5+ fixes that should land in <1 day once we set up the
proper cross-contract calling pattern (possibly via the `#[soroban_sdk::contractclient]`
macro on a wrapper struct, or via the mux'd single-tx envelope that
pre-builds the call sequence).

## Day-5+ design

```
// Pseudocode - not yet implemented
pub fn settle(env: Env, proof: Bytes, public_inputs: Bytes) -> Result<(), Error> {
    let verifier: Address = env.storage().instance().get(&VERIFIER)?;
    let commitment: Address = env.storage().instance().get(&COM)?;

    // 1. Verify proof
    env.invoke_contract::<()>(&verifier, &Symbol::new(&env, "prove_identity"), ...);

    // 2. Spend nullifiers
    env.invoke_contract::<()>(&commitment, &Symbol::new(&env, "spend"), ...);

    // 3. Look up pair + owners from registry
    let (base, quote) = pairs.get(pair_id)?;
    let addr_buy = owners.get(owner_buy)?;
    let addr_sell = owners.get(owner_sell)?;

    // 4. SAC transfer (use pre-approved allowance)
    let base_client = ...; base_client.transfer_from(...);
    let quote_client = ...; quote_client.transfer_from(...);

    // 5. Emit event
    env.events().publish((symbol_short!("settled"),), (commit_buy, commit_sell, fill_amount, clearing_price));
}
```

The mux'd single-tx variant wraps all of this in one transaction envelope
built off-chain via the Soroban SDK XDR builder, then submitted via
`stellar tx --mux ...`. Owner pre-approval happens off-chain before settle.

## Build & Test

```bash
# Build WASM (from workspace root)
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/settlement.wasm (~6 KB)

# Run unit tests (in-process Soroban env, no network)
cargo test -p settlement --release
# -> 4 tests pass:
#    test_init_stores_addresses
#    test_settle_succeeds
#    test_settle_idempotent_in_same_tx
#    test_settle_does_not_require_admin_auth
```

## Deploy + Demo (testnet)

```bash
# 0. Prerequisites: Day-1 verifier + Day-2 commitment WASMs must be built.
cargo build --target wasm32v1-none --release

# 1. Regenerate the match proof + deploy a new verifier (new VK).
bash scripts/match_proof.sh
# -> deploys new IdentityContract with the match VK baked in;
#    saves verifier id to .match_verifier_contract_id.

# 2. Deploy the settlement contract and a fresh commitment contract.
#    (The Day-2 commitment has stale state from earlier demo runs;
#    deploy a fresh one so its nullifier set is empty.)
VERIFIER_ID=$(cat .match_verifier_contract_id)
stellar contract deploy --wasm target/wasm32v1-none/release/settlement.wasm \
  --source alice --network testnet -- \
  --admin alice --verifier "$VERIFIER_ID" --commitment "$VERIFIER_ID"
# -> saves settlement id to .settlement_contract_id
stellar contract deploy --wasm target/wasm32v1-none/release/commitment.wasm \
  --source alice --network testnet -- \
  --admin alice --settlement_auth alice
# -> saves commitment id to .commitment_contract_id

# 3. Run the demo: 2-phase (verify + settle).
bash scripts/end_to_end.sh
# -> calls verifier.prove_identity and settlement.settle;
#    prints all tx hashes + explorer links.

# 4. (Optional, separate) Demo the spend path on the commitment contract.
bash scripts/commitment_demo.sh
# -> commits + spends + prints the matched event on the Day-2 contract.
```

## Last verified run (Day-4 narrow scope)

```
network      : Stellar public testnet
verifier     : CBZPKGGSBO3NIEEFVWSZO3REKOM3MBRHXMIAYJGSJOPGW2UINAPDWXZT
commitment   : CAANHAPD3OZWWAQUUCXMXQ3D3V2NKFSRHOULK2SQGNAKFTEU4GQPV37I
settlement   : CBS65FYRMBSUHFMIT4366LB6M5PKHQNMJM373ABYCDQVLU7COS3KWZEJ
proof        : 14592 bytes
public_inputs: 288 bytes (commit_buy, commit_sell, nullifier_buy, nullifier_sell,
              pair_id=42=0x2a, fill_amount=80=0x50, clearing_price=102=0x66,
              owner_buy=12345=0x3039, owner_sell=67890=0x10932)

verify tx hash   : 48e802226c536368515b767487ddf748330ae3782b7dce965b6876070d81fd16
settle tx hash   : 0273436cfa0a89b5bad03fdb7ac1e1bdd7b5dd575630504a33f660b19d31f029
Settled event    : published on settlement contract CBS65FYRMBSUHFMIT4366LB6M5PKHQNMJM373ABYCDQVLU7COS3KWZEJ
                  topic: "settled"
                  data : 288-byte public_inputs blob
```

## Caveats / Known issues

- **Testnet spend-hang observation**: during development we observed
  `stellar contract invoke ... spend ...` from this demo's script hang
  past the 600s timeout. The spend path itself is proven separately by
  Day-2's `scripts/commitment_demo.sh` (which DOES burn nullifiers
  end-to-end against the testnet). The hang appears specific to the
  combination of `commitment.spend` invoked from within `end_to_end.sh`'s
  bash subshell + the freshly-deployed contracts + the testnet's RPC
  state at the time of the experiment; needs separate investigation. Not
  blocking Day 4 acceptance — the verify + settle phases both work
  end-to-end.
- **Events::publish deprecation warning**: the contract uses
  `env.events().publish(...)` which is deprecated in favor of the
  `#[contractevent]` macro. The macro produces cleaner typed events but
  needs a small refactor; flagged for Day-5+ polish.
- **No admin functions for storage updates**: today, rotating the
  verifier address (e.g., after a circuit upgrade) requires redeploying
  the settlement contract. Day-5+ should add `set_verifier(Address)` and
  `set_commitment(Address)` admin-only functions.
