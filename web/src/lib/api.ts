// Lumen Dark Pool - matcher API + on-chain calls.
//
// v1 architecture:
//   1. User fills the order form in the browser.
//   2. Browser computes commitment + nullifier locally (src/lib/poseidon.ts)
//      and POSTs the plaintext order + commitment + nullifier to the matcher
//      (v1 trust boundary; documented in /web/README.md).
//   3. Browser calls commitment.commit(commitment) via the connected wallet.
//   4. The matcher (a separate Node process) polls Committed events, sees the
//      order, and when a crossable BUY/SELL exists, runs the Day-3 prover and
//      calls settlement.settle(public_inputs).
//   5. UI polls the matcher for MyOrders + Activity.
//
// For demo we sign transactions with a local keypair (the matcher's signer,
// since it fronts the prover anyway). A production build would route through
// the user's Wallets Kit.

import {
  Contract,
  nativeToScVal,
  TransactionBuilder,
  Account,
  rpc,
  Keypair,
  StrKey,
  xdr,
  Networks,
} from "@stellar/stellar-sdk";
import { NETWORK, CONTRACTS } from "./config";
import type { MyOrder, ActivityEntry, OrderPayload, StoredOrder } from "./types";
import { commit6Hex, null2Hex } from "./poseidon";

const RPC = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });

// ---------------------------------------------------------------------------
// Poseidon commitment (client-side) - MATCHES /prover/compute-hash v0.2.0.
// ---------------------------------------------------------------------------

export function computeCommitment(o: OrderPayload, domainHex: string): {
  commitment: string;
  nullifier: string;
} {
  const ownerScalar = addressToFr(o.trader);
  const commitment = commit6Hex({
    side: o.side,
    pair_id: o.pair_id,
    amount: o.amount,
    limit_price: o.limit_price,
    owner: ownerScalar,
    nonce: o.nonce,
  });
  const nullifier = null2Hex(commitment, domainHex);
  return { commitment, nullifier };
}

// Map a Stellar G... address to a BN254 scalar field element from the raw
// ed25519 pubkey (32 bytes) interpreted big-endian reduced mod r.
function addressToFr(addr: string): bigint {
  const decoded = StrKey.decodeEd25519PublicKey(addr); // Buffer
  let v = 0n;
  for (let i = 0; i < decoded.length; i++) v = (v << 8n) | BigInt(decoded[i]);
  const R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;
  return ((v % R) + R) % R;
}

// ---------------------------------------------------------------------------
// Submit order to matcher + commit on-chain.
// ---------------------------------------------------------------------------

export async function submitOrder(o: OrderPayload): Promise<{ txHash: string }> {
  const domain = "0x0c7d7e0c7d4e5f4e4f424c555f4e554c5f444f4d41494e5f7631";
  const { commitment, nullifier } = computeCommitment(o, domain);

  // 1. POST plaintext to matcher (v1 trust boundary - matcher sees the order
  //    in cleartext). Matcher is local on Day-5 demo; in production this is
  //    replaced with encrypted order pool / MPC.
  await fetch("/matcher/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...o,
      commitment,
      nullifier,
      created_at: Date.now(),
    } satisfies StoredOrder),
  });

  // 2. Call commitment.commit(commitment). For the demo we use the matcher's
  //    keypair as a stand-in signer. A real wallet demo would route this via
  //    Wallets Kit's signTransaction.
  const txHash = await invokeContract({
    contractId: CONTRACTS.commitment,
    functionName: "commit",
    args: [nativeToScVal(commitBytes(commitment))],
  });

  return { txHash };
}

// ---------------------------------------------------------------------------
// My orders - polled from the matcher.
// ---------------------------------------------------------------------------

export async function listMyOrders(trader: string): Promise<MyOrder[]> {
  try {
    const r = await fetch(`/matcher/orders?trader=${encodeURIComponent(trader)}`);
    if (!r.ok) return [];
    return (await r.json()) as MyOrder[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Activity - last N Settled events from the matcher.
// ---------------------------------------------------------------------------

export async function listActivity(limit = 10): Promise<ActivityEntry[]> {
  try {
    const r = await fetch(`/matcher/activity?limit=${limit}`);
    if (!r.ok) return [];
    return (await r.json()) as ActivityEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Low-level: build + submit a Soroban contract invocation via RPC.
// ---------------------------------------------------------------------------

async function invokeContract(params: {
  contractId: string;
  functionName: string;
  args: xdr.ScVal[];
}): Promise<string> {
  // v1 demo: use the matcher's keypair as a fixed signer. In a real demo the
  // user signs via their own wallet (Wallets Kit).
  const kp = (window as unknown as { __LUMEN_DEMO_KEYPAIR?: Keypair })
    .__LUMEN_DEMO_KEYPAIR;
  if (!kp) {
    throw new Error("demo keypair missing - run scripts/dev.sh");
  }

  const acct = await RPC.getAccount(kp.publicKey());
  const contract = new Contract(params.contractId);

  const tx = new TransactionBuilder(
    new Account(kp.publicKey(), acct.sequenceNumber()),
    {
      fee: "10000000",
      networkPassphrase: NETWORK.passphrase,
    },
  )
    .addOperation(contract.call(params.functionName, ...params.args))
    .setTimeout(30)
    .build();

  tx.sign(kp);
  const res = await RPC.sendTransaction(tx);
  const status = (res as { status?: string }).status;
  if (status && status !== "PENDING" && status !== "SUCCESS") {
    throw new Error(
      `tx not accepted: ${JSON.stringify(res).slice(0, 200)}`,
    );
  }
  return (res as { hash: string }).hash;
}

function commitBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length !== 64) throw new Error("commitment must be 32 bytes");
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Unused exports kept for type compatibility with the rest of the app.
export { Networks };
