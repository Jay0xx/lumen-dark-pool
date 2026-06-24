#!/usr/bin/env bash
# Lumen Dark Pool - Day 3 match-circuit proof demo.
#
# What this does:
#   1. Build the match circuit (nargo compile + execute) against the T1 happy-path
#      Prover.toml (already populated with the correct commitment + nullifier
#      values computed via /prover/compute-hash, parity-verified by `nargo test`).
#   2. Generate the UltraHonk proof + VK (bb, keccak oracle, matching Day 1).
#   3. Deploy a FRESH verifier (same `identity` contract from Day 1, just with
#      the match VK baked in) to Stellar testnet. The contract is VK-agnostic;
#      each deployment verifies one specific circuit.
#   4. Invoke `prove_identity` against the deployed contract; assert the host
#      returns success (proof verified on-chain).
#
# Idempotency: the script always deploys a new verifier (testnet XLM is free),
# and writes the new contract id to .match_verifier_contract_id for inspection.
#
# Day 4 will wire this verifier into the settlement_auth path on the commitment
# contract so that a successful `prove_identity` triggers a mux'd
# PathPaymentStrictSend that atomically clears the matched orders.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchain (assumed on PATH; see SETUP.md) ---
: "${PATH:="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"}"
export PATH
for bin in stellar nargo bb cargo rustc jq xxd; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin - see SETUP.md" >&2; exit 1; }
done

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-alice}"
MATCH_DIR="$ROOT/circuits/match"
TARGET_DIR="$MATCH_DIR/target"
WORKSPACE_ROOT="$ROOT"
VERIFIER_WASM="$WORKSPACE_ROOT/target/wasm32v1-none/release/identity.wasm"
CONTRACT_ID_FILE="$ROOT/.match_verifier_contract_id"

# --- Phase 1: build circuit + witness ----------------------------------------
echo "==[1/5] Build match circuit (compile + execute)========================"
( cd "$MATCH_DIR" && nargo compile && nargo execute )

# --- Phase 2: bb prove + write_vk ----------------------------------------------
echo "==[2/5] bb prove + bb write_vk (UltraHonk / keccak)===================="
bb prove \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path "$TARGET_DIR/match.json" \
  --witness_path  "$TARGET_DIR/match.gz" \
  --output_path   "$TARGET_DIR" \
  --output_format bytes_and_fields

bb write_vk \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path "$TARGET_DIR/match.json" \
  --output_path   "$TARGET_DIR" \
  --output_format bytes_and_fields

[[ -f "$TARGET_DIR/vk" ]] || { echo "missing VK at $TARGET_DIR/vk" >&2; exit 1; }
[[ -f "$TARGET_DIR/proof" ]] || { echo "missing proof at $TARGET_DIR/proof" >&2; exit 1; }

# --- Phase 3: deploy fresh verifier ------------------------------------------
# Same Day-1 `identity.wasm` contract (VK-agnostic). Each deployment
# permanently bakes the supplied VK into its instance storage.
echo "==[3/5] Deploy verifier (identity.wasm + match VK) to $STELLAR_NETWORK="
DEPLOY_OUTPUT="$(stellar contract deploy \
  --wasm "$VERIFIER_WASM" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  --vk_bytes-file-path "$TARGET_DIR/vk")"
CONTRACT_ID="$(echo "$DEPLOY_OUTPUT" | grep -E '^C[A-Z0-9]{55}$' | tail -1)"
if [[ -z "$CONTRACT_ID" ]]; then
  echo "could not parse contract id from deploy output:" >&2
  echo "$DEPLOY_OUTPUT" >&2
  exit 1
fi
echo "$CONTRACT_ID" > "$CONTRACT_ID_FILE"
echo "verifier deployed: $CONTRACT_ID"

# --- Phase 4: invoke prove_identity -----------------------------------------
echo "==[4/5] Invoke prove_identity against deployed verifier================"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  prove_identity \
  --public_inputs-file-path "$TARGET_DIR/public_inputs" \
  --proof_bytes-file-path    "$TARGET_DIR/proof"

# --- Phase 5: report ----------------------------------------------------------
echo
echo "MATCH PROOF VERIFIED ON-CHAIN"
echo "  circuit   : circuits/match"
echo "  verifier   : $CONTRACT_ID"
echo "  network    : $STELLAR_NETWORK"
echo "  explorer   : https://stellar.expert/explorer/$STELLAR_NETWORK/contract/$CONTRACT_ID"
echo "  tx history : https://stellar.expert/explorer/$STELLAR_NETWORK/tx?filter=contracts&$CONTRACT_ID"

PROOF_BYTES=$(wc -c < "$TARGET_DIR/proof")
VK_BYTES=$(wc -c < "$TARGET_DIR/vk")
echo "  proof size : $PROOF_BYTES bytes"
echo "  vk size    : $VK_BYTES bytes"
