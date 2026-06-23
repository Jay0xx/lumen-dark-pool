# 🛡️ Lumen Dark Pool

> **ZK dark pool / anti-MEV order matching that settles atomically via Stellar's native DEX path payments.**
> Built for **Stellar Hacks: Real-World ZK** — *"Prove what's true. Reveal nothing."*

---

## ❓ The Problem
On-chain order books leak. The moment an order is visible in the mempool, it can be **front-run, sandwiched, and MEV-extracted**. Privacy-only solutions (mixers, confidential transfers) hide *who* and *how much* — but they don't fix *fair ordering*.

## 💡 The Idea
A **dark pool** where orders stay hidden until matched, and a **zero-knowledge proof** guarantees the match is valid and fairly priced — settled atomically through **Stellar's native DEX path payments** (a primitive unique to Stellar).

- **ZK is the product**, not a privacy add-on: the proof *is* the trust between counterparties who never see each other's orders.
- **Stellar is load-bearing**: settlement rides Stellar's atomic path payments + built-in DEX, not a generic chain.

## 🔁 How It Works
1. **Commit** — A trader posts a Poseidon commitment of `(side, asset_pair, amount, limit_price, nonce)` to a Soroban contract. Order details stay private.
2. **Match (off-chain prover)** — A matcher runs a ZK circuit proving:
   - the two committed orders **cross** (`buy.price ≥ sell.price`),
   - the **fill amount + clearing price** follow a deterministic, fair rule (e.g. midpoint),
   - both commitments are **valid and unspent** (nullifiers prevent replay).
3. **Verify + Settle (on-chain)** — The Soroban contract verifies the proof (Groth16 / UltraHonk), marks nullifiers spent, and triggers an **atomic Stellar path payment** to settle.
4. **No front-running** — order contents are never revealed pre-match, and the circuit enforces the clearing rule, so the matcher **can't profitably reorder**.

## 🏗️ Architecture
```
┌────────────┐   commit(order)    ┌──────────────────────┐
│  Trader UI │ ─────────────────► │  Order Commitment     │
│ (Wallets   │                    │  Contract (Soroban)   │
│  Kit)      │ ◄───────────────── │  - Poseidon commits   │
└────────────┘   match + settle   │  - nullifier set      │
      ▲                           └──────────┬────────────┘
      │                                      │ verify(proof)
      │                           ┌──────────▼────────────┐
┌─────┴───────┐   proof           │  ZK Verifier Contract  │
│  Matcher /  │ ────────────────► │  (UltraHonk / Groth16) │
│  Prover     │                   └──────────┬────────────┘
│ (Noir off-  │                              │ on success
│  chain)     │                   ┌──────────▼────────────┐
└─────────────┘                   │  Stellar DEX           │
                                  │  atomic path payment   │
                                  └────────────────────────┘
```

## 🧰 Tech Stack
| Layer | Choice | Notes |
|-------|--------|-------|
| Circuits | **Noir** (Aztec) | pairs with UltraHonk Soroban verifier |
| Proving fallback | RISC Zero zkVM | Nethermind Stellar RISC0 verifier |
| Smart contracts | **Soroban** (Rust) | Protocol 26 SDK; BN254 + Poseidon host fns |
| Settlement | **Stellar DEX path payments** | atomic on-chain settlement |
| Frontend | Stellar Wallets Kit | minimal submit/match/settle UI |

## 📚 Key References
- ZK Proofs skill: https://skills.stellar.org/skills/zk-proofs/SKILL.md
- ZK on Stellar docs: https://developers.stellar.org/docs/build/apps/zk
- Privacy on Stellar: https://developers.stellar.org/docs/build/apps/privacy
- UltraHonk Soroban verifier: https://github.com/yugocabrio/rs-soroban-ultrahonk
- Nethermind Private Payments PoC (commit+nullifier+Groth16 pattern): https://github.com/NethermindEth/stellar-private-payments
- RISC Zero Stellar verifier: https://github.com/NethermindEth/stellar-risc0-verifier
- BN254 host fns: https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_bn254/
- Poseidon host fns: https://docs.rs/soroban-sdk/latest/soroban_sdk/_migrating/v25_poseidon/

## 🗺️ Build Plan
- [ ] **Day 1** — Read skills/docs; local Quickstart network; "hello proof" verifying on-chain
- [ ] **Day 2** — Order-commitment contract (Poseidon commits + nullifier set) + tests
- [ ] **Day 3** — Matching circuit in Noir (price-cross + clearing price + nullifiers)
- [ ] **Day 4** — Wire verifier → atomic path-payment settlement on testnet
- [ ] **Day 5** — Minimal web UI (Stellar Wallets Kit)
- [ ] **Day 6** — Polish, README, 2–3 min demo video, submit BUIDL

## ✅ Submission Checklist (Stellar Hacks: Real-World ZK)
- [ ] Public open-source repo with clear README *(this repo)*
- [ ] 2–3 min demo video
- [ ] Uses ZK meaningfully **and** touches Stellar

## 📂 Repo Layout (planned)
```
/contracts      Soroban contracts (commitment, verifier, settlement)
/circuits       Noir circuits (order match)
/prover         off-chain matcher + proof generation
/web            Stellar Wallets Kit frontend
/scripts        deploy + testnet helpers
```

## ⚠️ Disclaimer
Hackathon prototype. **Testnet only.** Unaudited — do not use with real assets.

## 📄 License
MIT — see [LICENSE](./LICENSE).
