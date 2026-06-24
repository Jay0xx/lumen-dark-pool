// Lumen Dark Pool - Day 1 "hello proof"
// Proves knowledge of a BN254-field preimage `x` for a public hash `h`.
//
// Statement (public):  h
// Witness  (private):  x
// Constraint:         Poseidon2::hash([x]) == h
//
// Poseidon here is the upstream `noir-lang/poseidon` crate (Poseidon2 over
// the BN254 scalar field). The same field the on-chain UltraHonk verifier
// operates over, and the same field Stellar's Poseidon host functions
// (CAP-0075) hash. Any commitment scheme we build on top of this circuit
// will therefore hash in-circuit exactly as the contract can re-verify
// on-chain.
//
// One circuit, one constraint - the minimum required to stand up the
// verifier path on Day 1. Day 3 replaces it with the matcher circuit.
use dep::poseidon::poseidon2::Poseidon2;

fn main(x: Field, h: pub Field) {
    let computed = Poseidon2::hash([x], 1);
    assert(computed == h);
}

#[test]
fn test_hello_42() {
    // Sanity check: x = 42. Expected h matches the rs-soroban-ultrahonk
    // identity Prover.toml fixture, so the same witness works end-to-end.
    let x: Field = 42;
    let h = Poseidon2::hash([x], 1);
    main(x, h);
}
