# Lumen Dark Pool — Order-Matching Circuit Spec (v1)

**Source of truth for `/circuits/match/`.** Everything in the Noir project MUST
match this document. If reality and the spec diverge, fix the spec first and
rebase the code, never silently change the statement being proved.

## 1. Goal

A single Noir + UltraHonk circuit that proves a valid 1:1 match between a BUY
order and a SELL order on the same asset pair, **without** revealing either
order's amount, limit price, owner, or nonce. After verification on Soroban, an
atomic path-payment settlement executes on Stellar's native DEX.

## 2. Order Tuple

Each order is a 6-tuple of BN254 field elements. The owner is a per-trader
secret; the nonce is per-order randomness.

| Field     | Type   | Range / Meaning                                         |
| --------- | ------ | ------------------------------------------------------- |
| `side`    | Field  | `0` = BUY, `1` = SELL (only these two values accepted)  |
| `pair_id` | Field  | identifier of the asset pair (e.g. hash of base/quote)  |
| `amount`  | Field  | **u64-safe** base-asset amount in stroops; `> 0`        |
| `limit_price` | Field | **u64-safe** price in quote-units per base; `> 0`   |
| `owner`   | Field  | per-trader secret (hashed wallet key, for example)      |
| `nonce`   | Field  | per-order randomness; prevents replay / cross-linking   |

We cast `amount`, `limit_price`, and `fill_amount` to `u64` inside the circuit
so we can do integer arithmetic safely. All field elements therefore must fit
in 64 bits; this is enforced by an explicit range-via-bounds check where
needed (cast to u64 is the witness-side constraint for v1).

## 3. Commitment and Nullifier

```
commitment = Poseidon(side, pair_id, amount, limit_price, owner, nonce)
nullifier  = Poseidon(commitment, NULLIFIER_DOMAIN)
```

- `NULLIFIER_DOMAIN` is a public constant chosen to separate the
  commitment → nullifier derivation from any other Poseidon use. Encoded as
  the BN254 field element with little-endian bytes
  `b"LUMEN_NUL_DOMAIN_v1"` (the exact value is a const in `match.nr`).
- Poseidon parameter set: BN254-X5 (width 3, alpha 5, 64 full + partial rounds),
  matching Noir's `std::hash::poseidon::poseidon_hash` and Soroban's `poseidon`
  host function (CAP-0075). See §7.

## 4. Public and Private Inputs

### Public (must be agreed between matcher and contract; goes on chain)

| Name             | Type  | Notes                                       |
| ---------------- | ----- | ------------------------------------------- |
| `commit_buy`     | Field | Poseidon commitment of the buy order        |
| `commit_sell`    | Field | Poseidon commitment of the sell order       |
| `nullifier_buy`  | Field | Poseidon nullifier of the buy commitment    |
| `nullifier_sell` | Field | Poseidon nullifier of the sell commitment   |
| `pair_id`        | Field | shared by both openings (otherwise fails)   |
| `fill_amount`    | Field | u64-safe; the agreed fill quantity          |
| `clearing_price` | Field | u64-safe; the agreed deterministic midpoint |

### Private (witness; never appears on chain)

- Buy order: `side_b, amount_b, limit_b, owner_b, nonce_b`
- Sell order: `side_s, amount_s, limit_s, owner_s, nonce_s`

## 5. Constraints (must all hold)

**C1 — Commitment opening (both orders)**
```
computed_commit_b = Poseidon(side_b, pair_id, amount_b, limit_b, owner_b, nonce_b)
assert(computed_commit_b == commit_buy)
computed_commit_s = Poseidon(side_s, pair_id, amount_s, limit_s, owner_s, nonce_s)
assert(computed_commit_s == commit_sell)
```

**C2 — Side correctness**
```
assert(side_b == 0)
assert(side_s == 1)
```

**C3 — Same asset pair.** Implicit in C1 (both openings reuse the public
`pair_id`); explicit `assert` is added in the circuit for clarity.

**C4 — Prices cross**
```
let lb = limit_b as u64;
let ls = limit_s as u64;
assert(lb >= ls);
```

**C5 — Fair clearing price (deterministic midpoint, floor division)**
```
let sum = lb + ls;
let mid = sum / 2;                       // integer floor division
assert(clearing_price as u64 == mid);
assert(ls <= mid);
assert(mid <= lb);
```
Rounding direction: **floor**. Documented because it is the only rule the
matcher cannot manipulate. Example: `lb=105, ls=100 → mid=102`. Example:
`lb=104, ls=100 → mid=102`. Example: `lb=105, ls=101 → mid=103`.

**C6 — Fill amount is the minimum of the two**
```
let ab = amount_b as u64;
let as_ = amount_s as u64;
let m  = if ab < as_ { ab } else { as_ };
assert(fill_amount as u64 == m);
```

**C7 — Nullifier derivation**
```
assert(nullifier_buy  == Poseidon(commit_buy,  NULLIFIER_DOMAIN));
assert(nullifier_sell == Poseidon(commit_sell, NULLIFIER_DOMAIN));
```

**C8 — Non-trivial (no zero-amount dust orders)**
```
assert(ab > 0);
assert(as_ > 0);
assert(fill_amount as u64 > 0);
```

## 6. Acceptance Criteria

Each test below is runnable via `nargo test` from `/circuits/match/`.

| ID    | Scenario                            | Expected                                    |
| ----- | ----------------------------------- | ------------------------------------------- |
| T1 ✓  | Valid crossing pair                 | proof generates; verifier accepts           |
| T2 ✗  | Non-crossing pair (lb < ls)         | circuit fails at C4                         |
| T3 ✗  | Tampered `fill_amount` (off by 1)   | circuit fails at C6                         |
| T4 ✗  | Tampered `clearing_price`           | circuit fails at C5                         |
| T5 ✗  | Wrong `nullifier_buy` (swapped)     | circuit fails at C7                         |
| T6 ✗  | Zero `amount_b`                     | circuit fails at C8                         |
| T7 ✗  | Wrong `pair_id` on the sell opening | circuit fails at C1 or C3                   |

Concrete test-vector values live in `/circuits/test-vectors/`:

- `T1-valid.json` — the canonical happy-path order pair
- `T2-noncrossing.json`, `T3-tampered-fill.json`, `T4-tampered-price.json`,
  `T5-wrong-nullifier.json`, `T6-zero-amount.json`, `T7-wrong-pair.json`

## 7. Poseidon Parameter Compatibility

This circuit uses Noir's `std::hash::poseidon::poseidon_hash`. That
implementation targets:

- Field: BN254 scalar field `Fr`
- Parameters: **BN254-X5** (width `t=3`, S-box alpha=5, full rounds=64 total,
  partial rounds as in the EVM-friendly Poseidon spec)
- These are the same parameters used by Soroban's `poseidon` host function
  introduced by CAP-0075 in Protocol 25 / 26.

Consequence: any `commitment` or `nullifier` value computed off-chain by the
matcher using the same Noir stdlib function will hash identically inside the
Soroban contract when re-derived with the host function. Day-4 settlement can
independently recompute both commitments from public inputs and (optionally)
the openings, and assert the circuit's public commitments/nullifiers match.

**Before finalizing the circuit:** regenerate the test-vector commitments and
nullifiers using the actual `bb` (Barretenberg) backend being shipped with
this Noir version, and verify they match what the Soroban host function
returns. The `/circuits/scripts/verify-poseidon-parity.sh` helper does this
end-to-end check.

## 8. Out of Scope (v2+)

- Batch matching (N orders → one proof)
- Multiple asset pairs in a single proof
- Compliance / ASP membership proofs (Privacy-Pools style)
- Confidential settlement amounts (Confidential Token standard)
- Refund logic if the matcher goes offline after revealing openings

## 9. File Layout

```
circuits/
├── SPEC.md                      # this file
├── README.md                    # how to install, build, prove, test
├── match/                       # Noir project
│   ├── Nargo.toml
│   ├── Prover.toml              # T1 example inputs
│   ├── src/
│   │   └── match.nr             # circuit
│   └── tests/
│       └── match_tests.nr       # nargo test cases
├── test-vectors/                # JSON inputs for each T#
└── scripts/
    ├── prove.sh                 # generate proof + public inputs JSON
    └── verify-poseidon-parity.sh
```
