# Matching Circuit Spec — Lumen Dark Pool

Status: v1 (hackathon scope). Target proving system: **Noir + UltraHonk** (Soroban verifier).
Fallback: RISC Zero zkVM. Hash: **Poseidon** (BN254 field, matches Soroban host fns).

---

## 0. Goal
Prove that **two hidden orders form a valid, fairly-priced match** — without revealing order
contents — and produce nullifiers that prevent either order from being matched twice.

Scope v1 = **single match: one BUY ↔ one SELL on the same asset pair.** Batch matching is a stretch goal.

---

## 1. Order model
An order is the tuple:
```
order = (side, pair_id, amount, limit_price, owner, nonce)
```
| field        | type            | meaning |
|--------------|-----------------|---------|
| side         | field (0 / 1)   | 0 = BUY, 1 = SELL |
| pair_id      | field           | canonical id of asset pair (e.g. hash("XLM/USDC")) |
| amount       | field (u64)     | base-asset amount, fixed-point integer |
| limit_price  | field (u64)     | quote per base, fixed-point (PRICE_SCALE = 1e7) |
| owner        | field           | Stellar account id hash (binds order to a payout account) |
| nonce        | field           | random blinding factor (per order) |

**Commitment** (stored on-chain at commit time):
```
commitment = Poseidon(side, pair_id, amount, limit_price, owner, nonce)
```

**Nullifier** (revealed at match time, marked spent on-chain):
```
nullifier = Poseidon(commitment, NULLIFIER_DOMAIN)
```
NULLIFIER_DOMAIN is a fixed constant separating nullifiers from commitments.

---

## 2. Public inputs (verified on-chain)
| name            | meaning |
|-----------------|---------|
| commit_buy      | committed BUY order (must already exist on-chain) |
| commit_sell     | committed SELL order (must already exist on-chain) |
| nullifier_buy   | nullifier for BUY (contract checks unspent, then marks spent) |
| nullifier_sell  | nullifier for SELL |
| pair_id         | asset pair being settled |
| fill_amount     | base-asset amount to transfer (settlement reads this) |
| clearing_price  | quote-per-base price used for settlement |

> Everything else (sides, limits, owners, nonces) stays **private**.

## 3. Private inputs (witness)
- buy:  side_b, amount_b, limit_b, owner_b, nonce_b
- sell: side_s, amount_s, limit_s, owner_s, nonce_s

(plus pair_id, fill_amount, clearing_price re-derived/checked against public values)

---

## 4. Constraints (the proof)
1. **Commitment opening** — recomputed commitments equal the public ones:
   - Poseidon(0, pair_id, amount_b, limit_b, owner_b, nonce_b) == commit_buy
   - Poseidon(1, pair_id, amount_s, limit_s, owner_s, nonce_s) == commit_sell
2. **Side correctness** — side_b == 0 (BUY), side_s == 1 (SELL).
3. **Same market** — both orders use the public pair_id (already enforced via opening).
4. **Prices cross** — limit_b >= limit_s. (A buyer willing to pay >= a seller's ask.)
5. **Fair clearing price** — deterministic midpoint, no matcher discretion:
   - clearing_price == (limit_b + limit_s) / 2   (integer div; document rounding)
   - and limit_s <= clearing_price <= limit_b
6. **Fill amount** — fully-determined, not matcher-chosen:
   - fill_amount == min(amount_b, amount_s)
7. **Nullifier derivation** — nullifier_buy == Poseidon(commit_buy, DOMAIN), same for sell.
8. **Non-trivial** — amount_b > 0 and amount_s > 0 and fill_amount > 0.

> Constraints 5 & 6 are the anti-MEV core: price and size are a pure function of the two
> committed orders, so the matcher cannot reorder or reprice for profit.

---

## 5. On-chain responsibilities (NOT in the circuit)
The Soroban contract, on receiving a valid proof, must:
1. Verify both commitments exist in the commitment set.
2. Check nullifier_buy and nullifier_sell are **unspent**; reject if either is spent.
3. Mark both nullifiers spent (atomic).
4. Execute the **Stellar path payment** of fill_amount at clearing_price between the two owners.
All four steps must succeed atomically or revert.

---

## 6. Acceptance criteria (Day-3 done = all pass)
- ✅ A valid BUY/SELL pair where limit_b >= limit_s produces a proof that **verifies**.
- ✅ A non-crossing pair (limit_b < limit_s) **fails** to prove (or verification rejects).
- ✅ Tampering with fill_amount or clearing_price away from the deterministic values **fails**.
- ✅ Wrong nullifier derivation **fails**.
- ✅ Proof verifies inside the Soroban UltraHonk verifier contract (integration with Day-4).

---

## 7. Open questions / decisions to confirm
- Rounding direction for midpoint clearing price (favor neither side — document it).
- PRICE_SCALE / amount fixed-point precision vs. Stellar's 7-decimal asset model.
- Whether owner should be the raw account id or a hash (privacy vs. settlement convenience).
- Commitment set representation: simple map vs. Merkle tree (v1 can use a contract map of live commitments; Merkle is a stretch).

---
*v1 — keep it to a single clean match. A working 1↔1 proof that verifies on-chain beats a batch matcher that doesn't.*
