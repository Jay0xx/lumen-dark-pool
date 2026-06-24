#!/usr/bin/env bash
# Lumen Dark Pool - Day 5 one-command dev runner.
#
# Starts the off-chain matcher (Node, background) and the Vite web dev
# server (foreground). Both watch the deployed testnet contracts from
# /web/src/lib/config.ts.
#
# Prereqs:
#   - Day-1..4 contracts built and deployed (match_proof.sh, commitment
#     deploy, settlement deploy)
#   - `cd web && npm install` already done
#   - soroban-cli / stellar CLI on PATH (matcher uses it for any direct tx;
#     the web UI uses @stellar/stellar-sdk)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# --- Toolchain ---------------------------------------------------------------
: "${PATH:="$HOME/.local/bin:$HOME/.bb/bin:$HOME/.nargo/bin:$HOME/.cargo/bin:$PATH"}"
export PATH
for bin in node npm stellar; do
  command -v "$bin" >/dev/null 2>&1 || { echo "missing: $bin" >&2; exit 1; }
done

# --- Sanity: web build + matcher proof path exist ------------------------------
if [[ ! -f "$ROOT/web/package.json" ]]; then
  echo "web/package.json missing - run: cd web && npm install" >&2
  exit 1
fi
if [[ ! -f "$ROOT/circuits/match/target/proof" ]]; then
  echo "circuits/match/target/proof missing - run scripts/match_proof.sh once" >&2
  exit 1
fi
if [[ ! -f "$ROOT/circuits/match/target/public_inputs" ]]; then
  echo "circuits/match/target/public_inputs missing - run scripts/match_proof.sh once" >&2
  exit 1
fi

# --- Funding the matcher keypair (deterministic v1 key for the demo) ------
MATCHER_SECRET="SDOEXAMPLEMATCHERKEYPAIR0000000000000000000000000000000000XLM"
MATCHER_ADDR="GDOEXAMPLEMATCHERADDRESS000000000000000000000000000000000"

# Run Friendbot to fund the matcher keypair (ignore errors if already funded).
stellar keys add matcher --secret "$MATCHER_SECRET" 2>/dev/null || true
echo "Funding matcher via Friendbot..."
curl -sf "https://friendbot.stellar.org?addr=$MATCHER_ADDR" >/dev/null || echo "(funding skipped)"

# --- Start the matcher (background) ----------------------------------------
echo "Starting matcher on :8787..."
MATCHER_SECRET="$MATCHER_SECRET" MATCHER_PUBLIC="$MATCHER_ADDR" \
  npx --prefix "$ROOT/web" -- tsx "$ROOT/prover/matcher.ts" &
MATCHER_PID=$!
trap 'kill "$MATCHER_PID" 2>/dev/null || true' EXIT

# Brief settle so the matcher is reachable before the UI starts polling.
sleep 2

# --- Start the web dev server (foreground) -------------------------------
echo "Starting web dev server..."
cd "$ROOT/web"
exec npm run dev
