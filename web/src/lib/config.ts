// Lumen Dark Pool - frontend configuration.
//
// All network + contract addresses live here. Update these values after
// re-deploying the Day-2 commitment or Day-4 settlement contracts on testnet.

export const NETWORK = {
  // Stellar public testnet (also used by the Day-1..4 CLI scripts).
  passphrase: "Test SDF Network ; September 2015",
  rpcUrl:     "https://soroban-testnet.stellar.org",
  horizonUrl: "https://horizon-testnet.stellar.org",
  explorer:   "https://stellar.expert/explorer/testnet",
  friendbot:  "https://friendbot.stellar.org",
} as const;

// Hardcoded pair (Day-5 demo only). Production would let the user pick.
export const PAIR = {
  // The order tuple uses pair_id = 42 in every Day-3 test fixture; we
  // hardcode the same here so the off-chain matcher's proof generation is
  // valid.
  id: 42,
  // Display-only metadata (no on-chain meaning).
  baseSymbol:  "BASE",
  quoteSymbol: "QUOTE",
} as const;

// Deployed contract addresses (from Day-2 / Day-4 demo runs on this VM).
// Update these if you redeploy.
export const CONTRACTS = {
  verifier:   "CBZPKGGSBO3NIEEFVWSZO3REKOM3MBRHXMIAYJGSJOPGW2UINAPDWXZT",
  commitment: "CAANHAPD3OZWWAQUUCXMXQ3D3V2NKFSRHOULK2SQGNAKFTEU4GQPV37I",
  settlement: "CBS65FYRMBSUHFMIT4366LB6M5PKHQNMJM373ABYCDQVLU7COS3KWZEJ",
} as const;

// v1 matcher is a separate Node process started by scripts/dev.sh.
// Same-origin in production; for the demo we hardcode the dev port.
export const MATCHER_URL = "http://localhost:8787";
