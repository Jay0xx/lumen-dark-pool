# Lumen Dark Pool - Web UI (Day 5)

Minimal single-page React + Vite + TS app over the Day 1-4 contracts.

Aesthetic: light purple gradient bg, white cards, violet accents only.
See `../contracts/settlement/README.md` and `../SETUP.md` for the full
system architecture.

## Run

```bash
# Prereqs (Day 1-4):
#   bash scripts/hello_proof.sh          # builds Day-1 verifier WASM
#   bash scripts/match_proof.sh          # builds Day-3 proof + deploys match verifier
#   bash scripts/commitment_demo.sh     # deploys Day-2 commitment WASM (optional)
#   bash scripts/end_to_end.sh          # deploys Day-4 settlement WASM (optional)

# Then:
cd ..
bash scripts/dev.sh
# -> matcher on :8787 (background)
# -> Vite dev server on :5173 (foreground, default browser URL)
```

Open <http://localhost:5173>.

## Friendbot funding

The matcher signs txs on behalf of the demo. Run the Friendbot funding
inside `scripts/dev.sh`; if you change the matcher keypair, also re-fund
the new address with:
```bash
curl "https://friendbot.stellar.org?addr=$MATCHER_PUBLIC"
```

## Trust model (v1)

The user POSTs the plaintext order to the matcher (`POST /matcher/orders`).
The matcher can read the order contents and could front-run. **This is
deliberately narrow for the demo.** Production would use an encrypted
order pool or MPC so the matcher never sees order contents in cleartext.
The cryptographic privacy guarantees of the proof are still demonstrated
end-to-end; this is a trust placement issue, not a soundness issue.

## Files

- `src/App.tsx` - top-level shell
- `src/lib/{config,wallet,toast,api,poseidon,types}.{ts,tsx}` - primitives
- `src/components/{Header,Hero,OrderForm,MyOrders,ActivityFeed,Footer,WalletButton,Toaster}.tsx` - UI
- `src/index.css` - tailwind base + `.lumen-card` / `.lumen-glow` / `.lumen-pill` component classes
- `tailwind.config.js` - violet palette + Inter / Geist Mono typography
- `index.html` - Lumen brand meta + rsms.me Inter

The matching logic lives in `../prover/matcher.ts` (separate Node process).
The Day 1-4 CLI flows (`scripts/hello_proof.sh`, `commitment_demo.sh`,
`match_proof.sh`, `end_to_end.sh`) all keep working unchanged.

## Production checklist (NOT in Day 5 scope)

- Replace plain HTTP matchmaking with TLS + auth
- Replace plaintext POST with encrypted order pool / MPC
- Generate typed bindings (`stellar contract bindings typescript`) instead
  of the hand-written `src/lib/api.ts` invoke helpers
- Route all tx submission through the user's Wallets Kit instead of the
  matcher's keypair
- Add error retry + nonce replacement
- Persist orders + activity to disk (currently in-memory only)
