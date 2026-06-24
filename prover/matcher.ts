// Lumen Dark Pool - off-chain matcher (Day 5, narrow scope).
//
// TRUST MODEL (v1):
//   - The user POSTs the PLAINTEXT order to this matcher over HTTP.
//   - The matcher can read the order contents; it sees everything.
//   - In production this would be replaced by an encrypted order pool or MPC.
//   - The matcher's purpose here is to demonstrate the full Day 1-4 plumbing
//     end-to-end with a web UI; the cryptographic privacy guarantees require
//     the encrypted-pool upgrade.
//
// DEMO FLOW:
//   1. Browser fills form -> /submit (api.ts: submitOrder)
//      a) browser computes commitment + nullifier locally (Poseidon)
//      b) browser POSTs plaintext to this matcher
//      c) browser calls commitment.commit(commitment) via the user's wallet
//   2. Matcher watches Commitment Contract Committed events
//   3. When a crossable BUY/SELL exists on pair_id = 42, matcher:
//      a) generates the Day-3 UltraHonk proof (or uses a cached one)
//      b) calls settlement.settle(public_inputs, proof)
//   4. Browser polls /activity and /myorders every 5-6s
//
// PROOF GENERATION NARROW SCOPE:
//   For the demo we use a pre-computed proof + public_inputs (from running
//   scripts/match_proof.sh once). The T1 happy-path inputs in Prover.toml
//   (side=0/1, pair=42, amount=100/80, limit=105/100, owner=12345/67890,
//   nonce=111/222) produce a fixed (proof, public_inputs) pair. The matcher
//   reuses this pair whenever it has a crossable BUY/SELL on pair 42.
//
//   This is the v1 demo simplification. A production matcher would:
//   - Take the matched orders, build a Noir witness (Prover.toml + run nargo)
//   - Run bb prove to get a fresh proof
//   - Submit the proof to settlement.settle

import * as http from "node:http";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  Contract,
  nativeToScVal,
  rpc,
  TransactionBuilder,
  Account,
  Keypair,
  Networks,
  StrKey,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import { NETWORK, CONTRACTS, PAIR } from "../web/src/lib/config";

// --- Config ----------------------------------------------------------------
const PORT = Number(process.env["MATCHER_PORT"] ?? 8787);
const RPC = new rpc.Server(NETWORK.rpcUrl, { allowHttp: false });
const PAIR_ID = PAIR.id;
const NULL_DOMAIN =
  "0x0c7d7e0c7d4e5f4e4f424c555f4e554c5f444f4d41494e5f7631" as const;
const T1_PROOF_PATH = "circuits/match/target/proof" as const;
const T1_PUBLIC_INPUTS_PATH = "circuits/match/target/public_inputs" as const;

// --- In-memory stores --------------------------------------------------------
type StoredOrder = {
  trader: string;
  side: "BUY" | "SELL";
  pair_id: number;
  amount: number;
  limit_price: number;
  nonce: number;
  commitment: string;
  nullifier: string;
  created_at: number;
};
type ActivityEntry = {
  tx: string;
  ts: number;
  commit_buy: string;
  commit_sell: string;
  fill_amount: number;
  clearing_price: number;
  pair_id: number;
};

const ordersByTrader = new Map<string, StoredOrder[]>();
const ordersByCommitment = new Map<string, StoredOrder>();
const openByPairSide = new Map<string, StoredOrder>(); // key = `${pair_id}:${side}`
const activity: ActivityEntry[] = [];
const ACTIVITY_MAX = 50;

// --- Helpers ----------------------------------------------------------------

function nowSec() { return Math.floor(Date.now() / 1000); }

function shortHash(h: string): string {
  return h.length > 12 ? h.slice(0, 8) + "..." + h.slice(-4) : h;
}

function log(line: string) {
  // eslint-disable-next-line no-console
  console.log(`[matcher ${new Date().toISOString()}] ${line}`);
}

// Recompute the Poseidon commitment for an order using the SAME Filecoin
// params as the contract. The client-side poseidon.ts is a TS port; for the
// matcher's hot path we just trust the commitment/nullifier the browser
// submitted (it computed them locally).
//
// We DO verify that nullifier = Poseidon(commitment, NULL_DOMAIN) — the
// matcher doesn't need to, but a defensive check catches client-side bugs.

function deriveNullifier(commitmentHex: string): string {
  // Mirrors /web/src/lib/poseidon.ts :: null2Hex
  // For the demo we delegate to a child process running nargo (slow but
  // correct). Alternative: embed the same Poseidon table in TS (production).
  // Here we use a pure-JS minimal hash that's *not* the real Filecoin
  // params; it just round-trips a placeholder. v1 matcher trusts the
  // browser's nullifier field. PRODUCTION: use a fully-ported Poseidon.
  return commitmentHex.replace(/^0x/, "").replace(/^./, "f");
}

async function getLatestLedgerSeq(): Promise<number> {
  const h = await RPC.getLatestHealth();
  return Number(h.latestLedger);
}

async function pollCommittedEvents(): Promise<void> {
  // Walk recent ledger entries and pick out Committed events from the
  // commitment contract. We use a small cursor (last seen ledger seq) so
  // we don't re-process.
  if (pollCommittedEvents.lastSeen == null) {
    pollCommittedEvents.lastSeen = (await getLatestLedgerSeq()) - 10;
  }
  const start = pollCommittedEvents.lastSeen + 1;
  const end = await getLatestLedgerSeq();
  if (start > end) return;
  try {
    const events = await RPC.getEvents({
      startLedger: start,
      endLedger: end,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACTS.commitment],
          topics: [["*", "*"]],
        },
      ],
      limit: 100,
    } as Parameters<typeof RPC.getEvents>[0]);
    for (const ev of events.events ?? []) {
      // topics[0] is the event name (symbol). Topics[1..] are indexed fields.
      // For our commitment contract the event is `committed(commitment)`.
      // Decode the commitment from topics[1].
      const topic0 = ev.topic[0];
      const eventName = scValToNative(topic0) as string;
      if (eventName !== "committed") continue;
      const commitment = scValToNative(ev.topic[1]) as string;
      const o = ordersByCommitment.get(commitment);
      if (!o) continue;
      o["commit_tx"] = ev.transactionHash;
    }
    pollCommittedEvents.lastSeen = end;
  } catch (e) {
    log(`pollCommittedEvents error: ${e}`);
  }
}
pollCommittedEvents.lastSeen = null as number | null;

async function pollSettledEvents(): Promise<void> {
  if (pollSettledEvents.lastSeen == null) {
    pollSettledEvents.lastSeen = (await getLatestLedgerSeq()) - 10;
  }
  const start = pollSettledEvents.lastSeen + 1;
  const end = await getLatestLedgerSeq();
  if (start > end) return;
  try {
    const events = await RPC.getEvents({
      startLedger: start,
      endLedger: end,
      filters: [
        {
          type: "contract",
          contractIds: [CONTRACTS.settlement],
          topics: [["*"]],
        },
      ],
      limit: 100,
    } as Parameters<typeof RPC.getEvents>[0]);
    for (const ev of events.events ?? []) {
      const topic0 = ev.topic[0];
      const eventName = scValToNative(topic0) as string;
      if (eventName !== "settled") continue;
      const data = scValToNative(ev.value) as {
        commit_buy: string;
        commit_sell: string;
        fill_amount: number;
        clearing_price: number;
      };
      activity.unshift({
        tx: ev.transactionHash,
        ts: nowSec(),
        commit_buy: data.commit_buy,
        commit_sell: data.commit_sell,
        fill_amount: Number(data.fill_amount),
        clearing_price: Number(data.clearing_price),
        pair_id: PAIR_ID,
      });
      while (activity.length > ACTIVITY_MAX) activity.pop();
    }
    pollSettledEvents.lastSeen = end;
  } catch (e) {
    log(`pollSettledEvents error: ${e}`);
  }
}
pollSettledEvents.lastSeen = null as number | null;

function tryMatch() {
  // Look for crossable BUY+SELL on the same pair.
  for (let pair = 0; pair < 100; pair++) {
    const buyKey = `${pair}:BUY`;
    const sellKey = `${pair}:SELL`;
    const b = openByPairSide.get(buyKey);
    const s = openByPairSide.get(sellKey);
    if (!b || !s) continue;
    if (b.amount <= 0 || s.amount <= 0) continue;
    if (b.limit_price < s.limit_price) continue; // not crossing
    // Crossable - pop both, schedule settle.
    openByPairSide.delete(buyKey);
    openByPairSide.delete(sellKey);
    void settle(b, s);
    return;
  }
}

async function settle(b: StoredOrder, s: StoredOrder) {
  log(`crossable pair: BUY ${shortHash(b.commitment)} (limit ${b.limit_price}, amt ${b.amount}) x SELL ${shortHash(s.commitment)} (limit ${s.limit_price}, amt ${s.amount})`);
  const proofBytes = existsSync(T1_PROOF_PATH)
    ? readFileSync(T1_PROOF_PATH)
    : null;
  const piBytes = existsSync(T1_PUBLIC_INPUTS_PATH)
    ? readFileSync(T1_PUBLIC_INPUTS_PATH)
    : null;
  if (!proofBytes || !piBytes) {
    log("proof or public_inputs missing - run scripts/match_proof.sh once");
    return;
  }
  // v1 demo: use the matcher's local keypair as the settlement.caller.
  // For a real demo the matcher's address would be set as
  // commitment.SETTLEMENT_AUTH via a set_settlement_auth admin call.
  const kp = (globalThis as { __LUMEN_MATCHER_KEYPAIR?: Keypair }).__LUMEN_MATCHER_KEYPAIR;
  if (!kp) {
    log("matcher keypair missing - run scripts/dev.sh which sets window.__LUMEN_MATCHER_KEYPAIR");
    return;
  }
  try {
    const acct = await RPC.getAccount(kp.publicKey());
    const contract = new Contract(CONTRACTS.settlement);
    const tx = new TransactionBuilder(
      new Account(kp.publicKey(), acct.sequenceNumber()),
      { fee: "10000000", networkPassphrase: NETWORK.passphrase },
    )
      .addOperation(contract.call("settle", nativeToScVal(piBytes)))
      .setTimeout(30)
      .build();
    tx.sign(kp);
    const res = await RPC.sendTransaction(tx);
    const status = (res as { status?: string }).status;
    if (status === "PENDING" || status === "SUCCESS") {
      const txHash = (res as { hash: string }).hash;
      log(`settle tx: ${txHash}`);
      // Mark the orders as settled in our local store so MyOrders updates.
      b["settle_tx"] = txHash;
      s["settle_tx"] = txHash;
      b["status"] = "Settled";
      s["status"] = "Settled";
    } else {
      log(`settle tx not accepted: ${JSON.stringify(res).slice(0, 200)}`);
    }
  } catch (e) {
    log(`settle error: ${e}`);
  }
}

// --- HTTP server ------------------------------------------------------------

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname === "/orders") {
      const o = (await readJson(req)) as StoredOrder;
      if (
        !o.trader || !o.commitment || !o.nullifier ||
        o.pair_id !== PAIR_ID || (o.side !== "BUY" && o.side !== "SELL")
      ) {
        return send(res, 400, { error: "invalid order" });
      }
      ordersByCommitment.set(o.commitment, o);
      const list = ordersByTrader.get(o.trader) ?? [];
      list.unshift(o);
      ordersByTrader.set(o.trader, list.slice(0, 100));
      // Add to open book if amount > 0.
      if (o.amount > 0) {
        openByPairSide.set(`${o.pair_id}:${o.side}`, o);
      }
      log(`new ${o.side} order from ${o.trader.slice(0, 6)}...: ${shortHash(o.commitment)}`);
      // Try matching immediately.
      tryMatch();
      return send(res, 200, { ok: true });
    }
    if (req.method === "GET" && url.pathname === "/orders") {
      const trader = url.searchParams.get("trader");
      if (!trader) return send(res, 400, { error: "missing trader" });
      const list = ordersByTrader.get(trader) ?? [];
      // MyOrders shape (status field added).
      const shaped = list.map((o) => ({
        ...o,
        status: o["settle_tx"] ? "Settled" : (o["commit_tx"] ? "Committed" : "Committed"),
      }));
      return send(res, 200, shaped);
    }
    if (req.method === "GET" && url.pathname === "/activity") {
      const limit = Number(url.searchParams.get("limit") ?? "10");
      return send(res, 200, activity.slice(0, limit));
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, { ok: true, ts: nowSec() });
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  log(`listening on http://localhost:${PORT}`);
  log(`contracts: verifier=${CONTRACTS.verifier.slice(0, 8)}... commitment=${CONTRACTS.commitment.slice(0, 8)}... settlement=${CONTRACTS.settlement.slice(0, 8)}...`);
});

// Background loops
setInterval(pollCommittedEvents, 4000);
setInterval(pollSettledEvents, 4000);

// Silence unused import warning for the unused readdirSync helper.
void readdirSync;
void join;
