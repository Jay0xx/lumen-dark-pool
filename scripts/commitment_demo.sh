#!/usr/bin/env bash
# Lumen Dark Pool - Day 2 commitment + nullifier demo.
#
# End-to-end flow on Stellar public testnet:
#   1. Build the commitment contract WASM (if not already built).
#   2. Deploy to testnet with __constructor(admin=alice, settlement_auth=alice).
#   3. Compute commitment + nullifier for two orders via the off-chain helper
#      (Noir circuit at /prover/compute-hash, run via nargo execute).
#   4. Call contract.commit() for each commitment.
#   5. Call contract.spend() to atomically burn both nullifiers (succeeds,
#      emits a `matched` event).
#   6. Try to spend again -> must revert with NullifierAlreadySpent (idempotency).
#
# Re-running fails the second spend, proving the nullifier set actually burns
# the right values. The 64-hex-char hex strings printed by the helper are already
# the right shape for stellar's --*-file-path flags (raw 32 bytes per input).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchain (assumed on PATH; see SETUP.md for install) ---
: "${PATH:="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"}"
export PATH
for bin in stellar nargo cargo rustc jq xxd; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin - see SETUP.md" >&2; exit 1; }
done

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-alice}"
CIRCUIT_DIR="$ROOT/circuits/hello"
WORKSPACE_ROOT="$ROOT"
TARGET_DIR="$WORKSPACE_ROOT/target"
CONTRACT_NAME="commitment"
WASM_PATH="$WORKSPACE_ROOT/target/wasm32v1-none/release/${CONTRACT_NAME}.wasm"
HELPER_DIR="$ROOT/prover/compute-hash"
CONTRACT_ID_FILE="$ROOT/.commitment_contract_id"

# --- Helper ----------------------------------------------------------------------
#
# Run the off-chain helper with the given order tuple, print "COMMITMENT HEX" and
# "NULLIFIER HEX" on stdout. The Noir circuit's main() prints the Field values
# as 0x-prefixed lowercase hex (32 bytes / 64 hex chars) one per line. We capture
# both lines and write each to a raw-bytes file for the contract call.

compute_hash_pair() {
  local side="$1" pair="$2" amount="$3" price="$4" owner="$5" nonce="$6"
  ( cd "$HELPER_DIR" && \
    cat >Prover.toml <<EOF
side = "$side"
pair_id = "$pair"
amount = "$amount"
limit_price = "$price"
owner = "$owner"
nonce = "$nonce"
EOF
    # nargo execute writes target/<name>.json + .gz; main() prints two hex lines.
    nargo execute 2>&1
  )
}

# Convert 0x-prefixed 64-hex-char string to a file of 32 raw bytes.
hex_to_bytes_file() {
  local hex="$1" out="$2"
  local stripped="${hex#0x}"
  printf '%s' "$stripped" | xxd -r -p > "$out"
  if [[ ! -s "$out" ]]; then
    echo "hex_to_bytes_file: empty output for '$hex'" >&2; exit 1
  fi
}

# --- Phase 1: build WASM -----------------------------------------------------------
echo "==[1/5] Build commitment contract WASM================================"
cargo build --target wasm32v1-none --release
if [[ ! -f "$WASM_PATH" ]]; then
  echo "WASM not found at $WASM_PATH" >&2; exit 1
fi

# --- Phase 2: deploy -------------------------------------------------------------
echo "==[2/5] Deploy to $STELLAR_NETWORK (admin=alice, settlement_auth=alice)="
# Source alice signs the deploy tx AND the require_auth call in spend().
ADMIN="$STELLAR_SOURCE_ACCOUNT"
SET_AUTH="$STELLAR_SOURCE_ACCOUNT"
DEPLOY_OUTPUT="$(stellar contract deploy \
  --wasm "$WASM_PATH" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  -- \
  --admin "$ADMIN" \
  --settlement_auth "$SET_AUTH")"
# The deploy output may be multi-line; the last non-empty line is the contract id.
CONTRACT_ID="$(echo "$DEPLOY_OUTPUT" | grep -E '^C[A-Z0-9]{55}$' | tail -1)"
if [[ -z "$CONTRACT_ID" ]]; then
  echo "could not parse contract id from deploy output:" >&2
  echo "$DEPLOY_OUTPUT" >&2
  exit 1
fi
echo "$CONTRACT_ID" > "$CONTRACT_ID_FILE"
echo "deployed: $CONTRACT_ID"

# --- Phase 3: compute commitment + nullifier for two orders ---------------------
echo "==[3/5] Compute commitments + nullifiers via off-chain helper=========="

echo "  order 1: side=BUY pair=1 amount=1000 price=100 owner=42 nonce=1"
OUT1="$(compute_hash_pair 0 1 1000 100 42 1)"
HEX1_COMMITMENT="$(echo "$OUT1" | grep -E '^0x[0-9a-f]{64}$' | sed -n '1p')"
HEX1_NULLIFIER="$(echo  "$OUT1" | grep -E '^0x[0-9a-f]{64}$' | sed -n '2p')"
if [[ -z "$HEX1_COMMITMENT" || -z "$HEX1_NULLIFIER" ]]; then
  echo "could not parse helper output for order 1" >&2; echo "$OUT1" >&2; exit 1
fi
echo "  commitment = $HEX1_COMMITMENT"
echo "  nullifier  = $HEX1_NULLIFIER"

echo "  order 2: side=SELL pair=1 amount=800 price=90 owner=99 nonce=1"
OUT2="$(compute_hash_pair 1 1 800 90 99 1)"
HEX2_COMMITMENT="$(echo "$OUT2" | grep -E '^0x[0-9a-f]{64}$' | sed -n '1p')"
HEX2_NULLIFIER="$(echo  "$OUT2" | grep -E '^0x[0-9a-f]{64}$' | sed -n '2p')"
if [[ -z "$HEX2_COMMITMENT" || -z "$HEX2_NULLIFIER" ]]; then
  echo "could not parse helper output for order 2" >&2; echo "$OUT2" >&2; exit 1
fi
echo "  commitment = $HEX2_COMMITMENT"
echo "  nullifier  = $HEX2_NULLIFIER"

# Write raw-bytes files for the stellar CLI --*-file-path flags.
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT
hex_to_bytes_file "$HEX1_COMMITMENT" "$TMPDIR/c1.bytes"
hex_to_bytes_file "$HEX1_NULLIFIER"  "$TMPDIR/n1.bytes"
hex_to_bytes_file "$HEX2_COMMITMENT" "$TMPDIR/c2.bytes"
hex_to_bytes_file "$HEX2_NULLIFIER"  "$TMPDIR/n2.bytes"

# --- Phase 4: commit both orders -------------------------------------------------
echo "==[4/5] commit(commit1) and commit(commit2)============================"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  commit \
  --commitment-file-path "$TMPDIR/c1.bytes"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  commit \
  --commitment-file-path "$TMPDIR/c2.bytes"

# --- Phase 5: spend (atomic burn of both nullifiers; emits matched event) -------
echo "==[5/5] spend(null1, null2, commit1, commit2)============================"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  spend \
  --nullifier_buy-file-path  "$TMPDIR/n1.bytes" \
  --nullifier_sell-file-path "$TMPDIR/n2.bytes" \
  --commit_buy-file-path     "$TMPDIR/c1.bytes" \
  --commit_sell-file-path    "$TMPDIR/c2.bytes"

echo
echo "MATCHED (proof-of-concept)"
echo "  contract : $CONTRACT_ID"
echo "  network  : $STELLAR_NETWORK"
echo "  events   : https://stellar.expert/explorer/$STELLAR_NETWORK/contract/$CONTRACT_ID"
echo

# --- Bonus: idempotency check. A second spend with the SAME nullifiers must fail.
echo "==[bonus] Re-running spend() with same nullifiers (must revert)========="
set +e
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  spend \
  --nullifier_buy-file-path  "$TMPDIR/n1.bytes" \
  --nullifier_sell-file-path "$TMPDIR/n2.bytes" \
  --commit_buy-file-path     "$TMPDIR/c1.bytes" \
  --commit_sell-file-path    "$TMPDIR/c2.bytes"
SECOND_RC=$?
set -e
if [[ "$SECOND_RC" -ne 0 ]]; then
  echo "OK: second spend reverted (rc=$SECOND_RC) - nullifiers are actually burned"
else
  echo "FAIL: second spend succeeded; nullifier set is broken"
  exit 1
fi

echo
echo "DEMO COMPLETE"
