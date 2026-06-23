# /contracts

Soroban smart contracts (Rust, Protocol 26).

- **commitment/** — order-commitment store + nullifier set (Day 2)
- **verifier/** — UltraHonk / Groth16 proof verifier (Day 1)
- settlement logic wires verification -> atomic Stellar path payment (Day 4)

Uses BN254 + Poseidon host functions. Poseidon params must match `/circuits`.
