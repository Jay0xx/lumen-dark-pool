#!/usr/bin/env bash
# Lumen Dark Pool - Day 1 "hello proof" end-to-end script.
#
# What this does (and only this, by design):
#   1. Build the Noir circuit (nargo compile + execute)
#   2. Generate the UltraHonk proof + VK (bb)
#   3. Build the Soroban verifier contract WASM (cargo)
#   4. Deploy the verifier to Stellar testnet, passing the VK as a constructor arg
#   5. Invoke verify_proof on the deployed contract with our public_inputs + proof
#
# Exits non-zero on any failure. Prints the deployed contract id + tx hash on success.
#
# Usage:
#   bash scripts/hello_proof.sh                 # uses stellar 'alice' identity on testnet
#   STELLAR_NETWORK=testnet bash scripts/...    # explicit (default)
#
# Day 3+ will replace the hello circuit with the matcher circuit and the verify_proof
# call with settle_match + path_payment. The plumbing built here is the spine.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchain (assumed on PATH; see SETUP.md for install) ---
: "${PATH:="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"}"
export PATH
for bin in stellar nargo bb cargo rustc jq; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin - see SETUP.md" >&2; exit 1; }
done

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-alice}"
CIRCUIT_DIR="$ROOT/circuits/hello"
TARGET_DIR="$CIRCUIT_DIR/target"
WORKSPACE_ROOT="$ROOT"
CONTRACT_NAME="identity"            # matches Cargo.toml [package].name (vendored as-is from rs-soroban-ultrahonk)
WASM_PATH="$WORKSPACE_ROOT/target/wasm32v1-none/release/${CONTRACT_NAME}.wasm"
CONTRACT_ID_FILE="$ROOT/.contract_id"

echo "==[1/5] Build Noir circuit (compile + execute witness)==========="
( cd "$CIRCUIT_DIR" && nargo compile && nargo execute )

echo "==[2/5] bb prove + bb write_vk===================================="
bb prove \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path "$TARGET_DIR/hello.json" \
  --witness_path  "$TARGET_DIR/hello.gz" \
  --output_path   "$TARGET_DIR" \
  --output_format bytes_and_fields
bb write_vk \
  --scheme ultra_honk \
  --oracle_hash keccak \
  --bytecode_path "$TARGET_DIR/hello.json" \
  --output_path   "$TARGET_DIR" \
  --output_format bytes_and_fields

echo "==[3/5] Build Soroban verifier WASM==============================="
( cd "$WORKSPACE_ROOT" && cargo build --target wasm32v1-none --release )

if [[ ! -f "$WASM_PATH" ]]; then
  echo "WASM not found at $WASM_PATH" >&2; exit 1
fi
if [[ ! -f "$TARGET_DIR/vk" || ! -f "$TARGET_DIR/proof" || ! -f "$TARGET_DIR/public_inputs" ]]; then
  echo "missing circuit artifacts in $TARGET_DIR" >&2; exit 1
fi

echo "==[4/5] Deploy verifier to $STELLAR_NETWORK (constructor arg: VK)=="
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  --vk_bytes-file-path "$TARGET_DIR/vk")"
echo "$CONTRACT_ID" > "$CONTRACT_ID_FILE"
echo "deployed: $CONTRACT_ID"

echo "==[5/5] Invoke verify_proof on deployed contract=================="
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  prove_identity \
  --public_inputs-file-path "$TARGET_DIR/public_inputs" \
  --proof_bytes-file-path "$TARGET_DIR/proof"

echo
echo "PROOF VERIFIED ON-CHAIN"
echo "  contract : $CONTRACT_ID"
echo "  network  : $STELLAR_NETWORK"
echo "  explorer : https://stellar.expert/explorer/$STELLAR_NETWORK/contract/$CONTRACT_ID"
