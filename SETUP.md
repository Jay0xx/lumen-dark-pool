# Lumen Dark Pool — Setup

Day 1 goal: **a real ZK proof verifies on-chain via one reproducible script.**
Achieved. `bash scripts/hello_proof.sh` builds the Noir circuit, generates the
UltraHonk proof, builds the Soroban verifier WASM, deploys it to Stellar
testnet, and invokes `prove_identity` against it.

## 1. Toolchain

| Tool          | Version             | Where it lives                        |
| ------------- | ------------------- | ------------------------------------- |
| Rust          | 1.96.0              | `~/.cargo/bin/rustc`                  |
| `wasm32v1-none` target | latest     | `rustup target add wasm32v1-none`     |
| Stellar CLI   | 23.0.0              | `~/.local/bin/stellar`                |
| Noir / Nargo  | **1.0.0-beta.9**    | `~/.nargo/bin/nargo`                  |
| Barretenberg  | **v0.87.0**         | `~/.bb/bin/bb`                        |
| jq            | 1.7.1               | `~/.local/bin/jq`                     |

**Pin Nargo and bb to these exact versions.** Noir 1.0.0-beta.x is unstable
across betas — `poseidon` crate v0.2.0 does not compile under beta.22
(empty-slice type inference changed). bb 0.87.0 is the version Nethermind's
rs-soroban-ultrahonk ships with and is the only tag in `aztec-packages`
whose release tarball actually downloads.

## 2. Install

```bash
# Rust + WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32v1-none

# Stellar CLI (v23 prebuilt binary; no cargo build needed)
curl -fsSL -o /tmp/stellar-cli.tar.gz \
  https://github.com/stellar/stellar-cli/releases/download/v23.0.0/stellar-cli-23.0.0-x86_64-unknown-linux-gnu.tar.gz
mkdir -p ~/.local/bin
tar -xzf /tmp/stellar-cli.tar.gz -C ~/.local/bin stellar

# Noir 1.0.0-beta.9 (exact pin)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
~/.nargo/bin/noirup -v 1.0.0-beta.9

# Barretenberg v0.87.0 (the asset name is `barretenberg-amd64-linux.tar.gz`)
curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/cpp/installation/install | bash
~/.bb/bbup -v v0.87.0

# jq (bb shells out to it for JSON parsing during prove)
curl -fsSL -o ~/.local/bin/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64
chmod +x ~/.local/bin/jq
```

Add to `PATH` (one-time):

```bash
export PATH="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"
```

## 3. Fund an identity on testnet

```bash
stellar keys generate --global alice --network testnet
stellar keys fund alice --network testnet
stellar keys address alice
# GA2LBXWG73GTSLCANNVTDXXLTYOMRCHAWIKHSITYY7A332FQFS44UJVY  (one-time, but yours will differ)
```

Friendbot funds `alice` with test XLM on the public Stellar testnet.

## 4. Build the circuit artifacts + WASM

```bash
# One-time: copy crates/test-utils into the workspace tree (vendored from
# rs-soroban-ultrahonk). Needed only for `cargo test -p verifier`; cargo
# build --release works either way.
# (Already in repo; if starting fresh, copy from /tmp/rs-soroban-ultrahonk.)

cd lumen-dark-pool
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/identity.wasm  (41.7 KB)
```

## 5. Run the end-to-end demo

```bash
export PATH="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"
bash scripts/hello_proof.sh
```

Expected last lines:

```
==[5/5] Invoke verify_proof on deployed contract==================
null

PROOF VERIFIED ON-CHAIN
  contract : CBFHX2RGZCCZH44CX2SHCRVN2WQJ7DQJLBRVJL5F4QFWRDUDYCP7G46J
  network  : testnet
  explorer : https://stellar.expert/explorer/testnet/contract/CBFHX2RGZCCZH44CX2SHCRVN2WQJ7DQJLBRVJL5F4QFWRDUDYCP7G46J
```

The contract id is written to `.contract_id` after each run.

## 6. What the script does (and doesn't do)

`scripts/hello_proof.sh` is intentionally narrow:

1. `nargo compile` + `nargo execute` on `circuits/hello/` (Poseidon2-preimage circuit).
2. `bb prove` (UltraHonk, keccak oracle) + `bb write_vk`.
3. `cargo build --target wasm32v1-none --release` (verifier contract).
4. `stellar contract deploy ... --vk_bytes-file-path target/vk` (constructor takes VK).
5. `stellar contract invoke ... prove_identity --public_inputs-file-path --proof_bytes-file-path`.

It does **not** batch orders, hide order contents, or settle a trade.
Day 3 replaces the hello circuit with the matcher circuit and `prove_identity`
with `settle_match + PathPaymentStrictSend` (mux'd in one tx envelope).

## 7. Known gotchas (all hit during Day 1 build)

| Symptom                                                                 | Cause                                                                                              | Fix                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `error: Could not resolve 'poseidon' in path`                           | nargo stdlib `std::hash::poseidon` path is unstable across betas                                   | Use the external `poseidon = { tag = "v0.2.0", git = "https://github.com/noir-lang/poseidon" }` dep |
| `gzip: stdin: not in gzip format` from `bb prove`                       | bb shells out to `jq`                                                                              | Install jq: `curl -fsSL -o ~/.local/bin/jq https://github.com/jqlang/jq/releases/download/jq-1.7.1/jq-linux-amd64` |
| `Cannot open ~/.bb/bin`                                                 | bbup installer doesn't mkdir the bin dir                                                           | `mkdir -p ~/.bb/bin` before running `bbup`                                                |
| 176 errors: `cannot find serde_json / rand` inside `soroban-sdk/testutils.rs` | workspace feature unification pulls `testutils` from crates/test-utils' MAIN deps            | Comment out the `ultrahonk-test-utils` path dep in both `crates/ultrahonk-soroban-verifier/Cargo.toml` and `contracts/verifier/Cargo.toml` |
| `parsing argument public_inputs: value is not parseable to Some(Bytes,)` | Stellar CLI uses `--public_inputs-file-path`, not `--public_inputs`                                | Add `-file-path` suffix                                                                   |

## 8. Repo layout

```
lumen-dark-pool/
├── Cargo.toml                   # workspace (soroban-sdk 26.0.1 exact pin)
├── SETUP.md                     # this file
├── circuits/hello/              # the hello circuit
│   ├── Nargo.toml               # pinned to noir-lang/poseidon v0.2.0
│   ├── Prover.toml              # x=42, h=0x255ee829...
│   └── src/main.nr              # Poseidon2::hash([x], 1) == h
├── crates/
│   ├── ultrahonk-soroban-verifier/   # vendored from NethermindEth/rs-soroban-ultrahonk
│   └── test-utils/                   # vendored from same; only needed for cargo test
├── contracts/verifier/          # IdentityContract (vendored; renamed in spirit)
│   ├── Cargo.toml               # path dep on crates/ultrahonk-soroban-verifier
│   ├── src/lib.rs               # __constructor(env, vk_bytes) + prove_identity
│   └── tests/                   # negative-test scaffolding (requires host build)
├── scripts/hello_proof.sh       # the one-command demo
└── .contract_id                 # written by script on each run
```

## 9. What's next (Day 2-6)

- **Day 2:** Re-confirm hello proof from a fresh checkout using only this document.
- **Day 3:** Replace `circuits/hello` with the matcher circuit (1 buy ↔ 1 sell:
  Poseidon commitment opening, price-cross, midpoint clearing, nullifier
  derivation). Reuse this script as the CI spine.
- **Day 4:** Wire mux'd Soroban `verify_proof` + classic `PathPaymentStrictSend`
  in one tx envelope for atomic settlement.
- **Day 5:** Minimal web UI via Stellar Wallets Kit.
- **Day 6:** Polish, 2-3 min demo video, submit.

## 10. Day 2 — commitment + nullifier contract (shipped)

The on-chain state layer for the dark pool: stores commitments and
nullifiers, gates `spend` on `SETTLEMENT_AUTH.require_auth()`, enforces
atomic all-or-nothing burn of both nullifiers.

```bash
# Build WASM
cd lumen-dark-pool
cargo build --target wasm32v1-none --release
# -> target/wasm32v1-none/release/commitment.wasm  (6.3 KB)

# Run the in-process unit tests
cargo test -p commitment --release
# -> 6 tests pass: commit_stores_and_query, duplicate_commit_rejected,
#    spend_succeeds_when_inputs_valid, spend_reverts_on_missing_commitment,
#    spend_reverts_when_caller_not_settlement_auth,
#    atomicity_and_spent_nullifier_reverts

# End-to-end demo on Stellar public testnet (one command)
bash scripts/commitment_demo.sh
# Phases: build WASM -> deploy -> compute hashes via nargo execute ->
#          commit both -> spend (matched event) -> re-spend reverts.
```

Last successful run:

```
contract : CCY2VIBPQ5PTPDSPJUWPWQJ4TDNPQ36CADVTT5NQTDB2RILIHHLOYQ5D
network  : Stellar public testnet
deploy tx: 62cdaf4036e7517e4137f24958c6fcbf2f7108b10cbc35ece41e3afb2f6aae64
events   : 2x committed, 1x matched, 1x re-spend reverted (Error #5)
```

### Day 2 gotchas

| Symptom                                                                 | Cause                                                                                              | Fix                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `cargo build` 176 errors: `cannot find serde_json / rand` inside `soroban-sdk/testutils.rs` | Each new crate risks re-introducing testutils via a path dep. Stay disciplined: no path deps in member crates' `[dependencies]` (only `[dev-dependencies]` if at all). | Ensure `crates/test-utils/` is referenced ONLY from `[dev-dependencies]`; keep it out of any member crate's `[dependencies]`. |
| `error[E0432]: unresolved import soroban_sdk::Set`                       | `Set` type isn't exposed in soroban-sdk 26.0.1                                                       | Use `Map<BytesN<32>, ()>` as a Set; `contains_key` / `set(k, ())` are equivalent.            |
| `BytesN::from_array` takes 2 args, not 1                                | The signature is `from_array(env: &Env, items: &[u8; N])`                                          | Thread `&env` through your test helpers.                                                   |
| `cargo test` 12 errors: `no method named __constructor` on client      | The `CommitmentContractClient` doesn't expose `__constructor`; init happens at deploy time.        | Use `env.register(CommitmentContract, (admin, settlement_auth))` for in-process tests.    |
| Stellar CLI: `parsing argument commitment: value is not parseable`       | CLI expects raw bytes via `-file-path`, not inline hex                                              | Convert hex to raw bytes via `xxd -r -p` and pass `--commitment-file-path <file>`.        |

### Day 2 deviations from SPEC.md

- **Hash function:** `circuits/SPEC.md §7` calls for the BN254-X5 / EVM-friendly
  parameter set (rf=64, rp=204). The `noir-lang/poseidon v0.2.0` crate actually
  uses the Filecoin-style set (rf=8, rp=57, alpha=5, t=3 / t=7). We chose
  Filecoin-style so Day-3's `use dep::poseidon::poseidon::bn254::hash_6`
  produces identical commitments on-chain. Re-baseline to BN254-X5 in
  Day-5+ if needed for an external verifier.
- **On-chain Poseidon:** the contract stores OPAQUE `BytesN<32>` values.
  It does NOT call Poseidon host functions. Embedding the Filecoin constants
  would have added ~45 KB to the WASM (the verifier already pins
  `soroban-sdk = 26.0.1` to dodge the `testutils` feature flag). The
  off-chain helper and Day-3 circuit are the single source of truth
  for hash values; the contract is the store-and-burn layer.

## 11. Repo layout (current)

```
lumen-dark-pool/
├── Cargo.toml                   # workspace (soroban-sdk 26.0.1 exact pin)
├── Cargo.lock
├── SETUP.md                     # this file
├── .gitignore                   # excludes target/, .contract_id, etc.
├── contracts/
│   ├── verifier/                # Day 1: IdentityContract + UltraHonk verifier
│   └── commitment/              # Day 2: LIVE_COMMITMENTS + SPENT_NULLIFIERS
│       ├── Cargo.toml
│       ├── README.md             # Poseidon params pinned, deploy + invoke examples
│       ├── src/lib.rs
│       └── tests/commitment_test.rs
├── crates/
│   ├── ultrahonk-soroban-verifier/   # Day 1: BN254 verifier (~6.5 KB Rust)
│   └── test-utils/                   # dev-only; not in workspace members
├── circuits/
│   ├── hello/                   # Day 1: Poseidon2 preimage proof
│   └── match/                   # (pre-existing Day-3 skeleton)
├── prover/
│   └── compute-hash/            # Day 2: off-chain Poseidon helper (nargo execute)
│       ├── Nargo.toml
│       ├── Prover.toml
│       └── src/main.nr           # hash_6 + hash_2; prints to stdout
├── scripts/
│   ├── hello_proof.sh           # Day 1 one-command demo
│   └── commitment_demo.sh       # Day 2 one-command demo
└── .commitment_contract_id      # last deployed contract id
```
