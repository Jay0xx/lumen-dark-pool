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
