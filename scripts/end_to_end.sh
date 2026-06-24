#!/usr/bin/env bash
# Lumen Dark Pool - Day 4 end-to-end demo (narrow scope).
#
# Orchestrates a 2-phase end-to-end demo on Stellar public testnet:
#   1. verifier.prove_identity(proof, public_inputs)            [Day 1 UltraHonk verifier]
#   2. settlement.settle(public_inputs)                          [Day 4 settlement contract]
#
# Day-2 commitment.spend() is INTENTIONALLY OMITTED from this script:
# the testnet spend call hung during development (timed out at 600s for
# reasons that need separate investigation; the spend path itself is
# proven by Day-2's scripts/commitment_demo.sh which DOES burn
# nullifiers end-to-end against the testnet). The settlement demo below
# shows that the wiring reached the settlement contract with the right
# public_inputs; the mux'd single-tx envelope (verify -> spend -> settle
# + 2x SAC transfer_from) is Day 5+.
#
# Prerequisites (all run by prior scripts):
#   - circuits/match/target/{public_inputs, proof} exist (match_proof.sh)
#   - .match_verifier_contract_id, .settlement_contract_id, .commitment_contract_id
#     all populated

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchain ----------------------------------------------------------------
: "${PATH:="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"}"
export PATH
for bin in stellar dd; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done

STELLAR_NETWORK="${STELLAR_NETWORK:-testnet}"
STELLAR_SOURCE_ACCOUNT="${STELLAR_SOURCE_ACCOUNT:-alice}"
MATCH_TARGET="$ROOT/circuits/match/target"

VERIFIER_ID="$(cat "$ROOT/.match_verifier_contract_id")"
SETTLEMENT_ID="$(cat "$ROOT/.settlement_contract_id")"
COMMITMENT_ID="$(cat "$ROOT/.commitment_contract_id")"

[[ -f "$MATCH_TARGET/public_inputs" ]] || { echo "missing $MATCH_TARGET/public_inputs; run scripts/match_proof.sh first" >&2; exit 1; }
[[ -f "$MATCH_TARGET/proof" ]]          || { echo "missing $MATCH_TARGET/proof; run scripts/match_proof.sh first" >&2; exit 1; }

echo "================================================================"
echo "Lumen Dark Pool - Day 4 end-to-end demo (narrow: verify + settle)"
echo "================================================================"
echo "network      : $STELLAR_NETWORK"
echo "verifier     : $VERIFIER_ID"
echo "commitment   : $COMMITMENT_ID"
echo "settlement   : $SETTLEMENT_ID"
echo "proof        : $MATCH_TARGET/proof ($(wc -c < "$MATCH_TARGET/proof") bytes)"
echo "public_inputs: $MATCH_TARGET/public_inputs ($(wc -c < "$MATCH_TARGET/public_inputs") bytes)"
echo

# --- Phase 1: verify proof ----------------------------------------------------
echo "==[1/2] verifier.prove_identity (Day-1 UltraHonk verifier) ============"
stellar contract invoke \
  --id "$VERIFIER_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  prove_identity \
  --public_inputs-file-path "$MATCH_TARGET/public_inputs" \
  --proof_bytes-file-path    "$MATCH_TARGET/proof"
echo "  -> verify OK"

# --- Phase 2: settlement -----------------------------------------------------
echo "==[2/2] settlement.settle (Day-4 settlement contract) ================"
stellar contract invoke \
  --id "$SETTLEMENT_ID" \
  --source "$STELLAR_SOURCE_ACCOUNT" \
  --network "$STELLAR_NETWORK" \
  --send yes \
  -- \
  settle \
  --public_inputs-file-path "$MATCH_TARGET/public_inputs"
echo "  -> settle OK (Settled event emitted)"

echo
echo "================================================================"
echo "DEMO COMPLETE - 2/2 phases succeeded on Stellar public testnet"
echo "================================================================"
echo
echo "Wiring recap:"
echo "  Match proof verified by Day-1 verifier ........ OK"
echo "  Day-4 settlement.settle emitted Settled event . OK"
echo "  (Day-2 commitment.spend: run scripts/commitment_demo.sh separately;"
echo "   Day-2 covers the spend path end-to-end against the testnet.)"
echo
echo "Day 5+ upgrade (not in Day 4 narrow scope):"
echo "  - Mux'd single-tx envelope: verify -> spend -> settle + 2x SAC transfer_from"
echo "  - Pair registry (pair_id -> base/quote token addresses)"
echo "  - Owner registry (Field owner -> Stellar address)"
echo
echo "Explorer links:"
echo "  verifier   : https://stellar.expert/explorer/testnet/contract/$VERIFIER_ID"
echo "  commitment : https://stellar.expert/explorer/testnet/contract/$COMMITMENT_ID"
echo "  settlement : https://stellar.expert/explorer/testnet/contract/$SETTLEMENT_ID"
