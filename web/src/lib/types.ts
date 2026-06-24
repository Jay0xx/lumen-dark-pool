// Lumen Dark Pool - shared TypeScript types used by both the web app and the
// matcher (the matcher lives at /prover/matcher.ts; same shape kept in sync).

export type Side = "BUY" | "SELL";

export type OrderPayload = {
  trader: string;          // Stellar G... address (the trader / wallet)
  side: Side;
  pair_id: number;
  amount: number;          // u64 base units
  limit_price: number;     // u64 quote units per base unit (raw, no scaling here)
  nonce: number;           // u64
};

export type StoredOrder = OrderPayload & {
  commitment: string;      // 0x... 32-byte BN254 commitment
  nullifier:  string;      // 0x... 32-byte BN254 nullifier
  created_at: number;      // unix ms (matcher use)
};

export type Status = "Committed" | "Matched" | "Settled" | "Failed";

export type MyOrder = {
  /** Same commitment string we committed on-chain; frontend uses it to join
   *  with on-chain `is_committed` state and the matcher's stored plaintext. */
  commitment: string;
  nullifier:  string;
  side: Side;
  amount: number;
  limit_price: number;
  pair_id: number;
  /** tx hash of the commitment contract commit() call. */
  commit_tx: string;
  /** tx hash of the settlement.settle() call (if matched). */
  settle_tx: string | null;
  status: Status;
};

export type ActivityEntry = {
  /** tx hash of the settlement contract settle() call. */
  tx: string;
  /** unix seconds of the settlement event. */
  ts: number;
  commit_buy: string;
  commit_sell: string;
  fill_amount: number;
  clearing_price: number;
  pair_id: number;
};
