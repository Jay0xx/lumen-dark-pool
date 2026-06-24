# Match Circuit (Day 3)

ZK circuit that proves a valid, fairly-priced 1:1 match between a BUY
and a SELL order on the same asset pair — without revealing either
order's amount, limit price, owner, or nonce. After verification on
Soroban, an atomic path-payment settlement executes on Stellar's native
DEX (Day 4).

This is the **cryptographic core** of the Lumen Dark Pool. The
commitment contract (Day 2) and settlement wiring (Day 4) are layers on
top of this circuit.

## Pin: Poseidon Parameters

The circuit's commitments and nullifiers MUST equal what the Day-2
contract + off-chain helper compute. All three use the Filecoin-style
Poseidon shipped by
[`noir-lang/poseidon v0.2.0`](https://github.com/noir-lang/poseidon/tree/v0.2.0):

| Setting                | Value (commitment hash) | Value (nullifier hash) |
| ---------------------- | ----------------------- | ---------------------- |
| Function               | `bn254::hash_6`         | `bn254::hash_2`         |
| State width `t`        | 7                       | 3                      |
| Full rounds `rf`       | 8                       | 8                      |
| Partial rounds `rp`    | 57                      | 57                     |
| S-box exponent `alpha` | 5                       | 5                      |

> **SPEC §7 says BN254-X5 (EVM-friendly, rf=64).** We use Filecoin-style
> (rf=8, rp=57) instead — the `noir-lang/poseidon v0.2.0` crate ships
> only that set, and matching it guarantees Day-3's matcher hash == Day-2
> helper hash == Day-2 contract's expected commitment. Re-baseline to
> BN254-X5 in Day-5+ if needed for an external verifier; that requires
> regenerating ~45 KB of constants and updating every helper that touches
> them. The deviation is logged in `circuits/SPEC.md §7` and `/SETUP.md`.

### NULLIFIER_DOMAIN

Hardcoded in `src/lib.nr` as the BN254 scalar field element with
**little-endian** bytes of `"LUMEN_NUL_DOMAIN_v1"` truncated to 31 bytes:

```
NULLIFIER_DOMAIN = 0x0c7d7e0c7d4e5f4e4f424c555f4e554c5f444f4d41494e5f7631
```

Same constant appears in `/prover/compute-hash/src/main.nr`. **If this
changes, every previously-issued nullifier changes** — nullifier-set
migration required. Bump only with a hard-fork.

## Constraints (C1-C8 from SPEC §5)

The Noir code enforces all eight constraints via `src/lib.nr :: match_orders`:

| # | Constraint                          | Asserts                                                                                       |
| - | ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| C1 | Commitment opening                  | `bn254::hash_6(side, pair, amount, limit, owner, nonce)` matches `commit_buy` / `commit_sell`.  |
| C2 | Side correctness                    | `buy.side == 0`, `sell.side == 1`.                                                            |
| C3 | Same asset pair                     | Explicit assert: `buy.pair_id == sell.pair_id` (private).                                    |
| C4 | Prices cross                        | `limit_buy >= limit_sell` (cast to u64 before compare).                                       |
| C5 | Fair clearing price                 | `clearing_price == floor((limit_buy + limit_sell) / 2)`, bracketed `ls <= mid <= lb`.      |
| C6 | Fill amount = min                   | `fill_amount == min(amount_buy, amount_sell)`.                                                |
| C7 | Nullifier derivation                | `bn254::hash_2(commit, NULLIFIER_DOMAIN)` matches `nullifier_buy` / `nullifier_sell`.        |
| C8 | Non-trivial                         | `amount_buy > 0`, `amount_sell > 0`, `fill_amount > 0`.                                       |

**Rounding direction (C5):** integer floor. Per SPEC §5 C5 with examples:
`(105, 100) -> 102`, `(104, 100) -> 102`, `(105, 101) -> 103`. This is the
only rule the matcher cannot manipulate.

**C3 deviation note:** `public pair_id` is part of `PublicMatch` but is
**not** checked against the private orders' `pair_id` (only the two
private `pair_id`s are checked against each other). Tampering
`public pair_id` does NOT cause the circuit to fail. If you need public-
private pair_id linkage, add an explicit assert in C1's neighborhood.

## Build, Test, Prove

```bash
cd circuits/match

# 1. Run the in-crate test suite (8 scenarios).
nargo test
# -> 8 tests pass:
#    test_t1_valid_crossing_pair
#    test_t2_non_crossing_pair
#    test_t3_tampered_fill_amount
#    test_t4_tampered_clearing_price
#    test_t5_wrong_nullifier
#    test_t6_side_swap
#    test_t7_wrong_pair_id_in_opening
#    test_t8_zero_amount

# 2. Generate proof + VK + deploy verifier + invoke on-chain (one command).
cd ../..
bash scripts/match_proof.sh
# -> deploys a FRESH verifier (same Day-1 identity.wasm, new VK baked in),
#    invokes prove_identity, prints the contract id and proof size.

# 3. Negative-case suite (4 tampered inputs, each must revert on-chain).
bash scripts/match_proof_negative.sh
# -> 4/4 PASS (commit_buy fires C1; nullifier_buy fires C7;
#             fill_amount fires C6; clearing_price fires C5)
```

## Acceptance Evidence (last verified run)

```
verifier     : CAYUUWMFFXXBCPTTSVELSLIC5FYFXWOAH5QU7ZDCV66UYI3WQPYDU75G
network      : Stellar public testnet
proof size   : 14,592 bytes
VK size      : 1,760 bytes
deploy tx    : 6a3a5d9e10695b85663c2242ebb2b1410d829f69a21d37eebbd31fe809feaa89
explorer     : https://stellar.expert/explorer/testnet/contract/CAYUUWMFFXXBCPTTSVELSLIC5FYFXWOAH5QU7ZDCV66UYI3WQPYDU75G
happy path   : prove_identity returned void success (null)
negatives    : 4/4 reverted on-chain
nargo test   : 8/8 passed (T1 valid; T2-T8 each fires the right C-N)
```

## Architecture

```
                                +---------------------------+
                                |  Off-chain helper          |
                                |  /prover/compute-hash/     |
                                |                           |
                                |  nargo execute             |
                                |   bn254::hash_6(side,...)  |--> commit
                                |   bn254::hash_2(c, DOMAIN)|--> nullifier
                                |                           |
                                |   ^ SAME dep::poseidon     |
                                |   v0.2.0 + NULL_DOMAIN     |
                                +-------------+-------------+
                                              |
                                              v (parity verified by
                                                  8/8 nargo tests)
+-------------------+        +-----------------------------+       +------------------+
| Trader (Day 5 UI) |        | Soroban verifier            |       | Stellar chain    |
| (private orders)  |        | identity.wasm + match VK   |       |                  |
|                   |        | (Day-1 contract, fresh     |       | prove_identity() |
| builds (c, n)     | -----> |  deployment per circuit)   | ----> |                  |
| off-chain         |        |                             |       | on success ->    |
|                   |        | UltraHonk over BN254        |       | Matched event    |
+-------------------+        +-----------------------------+       +------------------+
                                                                 |
                                              Day 4 wires this    |
                                              prove_identity call |
                                              to the commitment   |
                                              contract's spend(), |
                                              with a mux'd         |
                                              PathPaymentStrictSend|
```

## What's NOT here (Day 4+)

- **No batching.** v1 is a single 1:1 match. The spec covers N orders in
  a single proof as Day-5+ stretch.
- **No Merkle tree on `LIVE_COMMITMENTS`.** Commitments are still opaque
  `BytesN<32>` in the Day-2 contract. Bumping to a Merkle tree would let
  `spend` accept a Merkle path and compose better with this proof.
- **No settlement wiring.** `prove_identity` is invoked here purely for
  verification; nothing happens on success yet. Day 4 wires it to the
  commitment contract's `SETTLEMENT_AUTH` and adds a mux'd
  `PathPaymentStrictSend`.
- **No `unused_function` warnings** for `assert_lt` / `assert_le` —
  helpers we built in case C4/C5 needed them; inlined arithmetic turned
  out to be cleaner. Safe to delete.
