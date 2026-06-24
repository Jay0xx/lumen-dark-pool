// Lumen Dark Pool - Day 5 minimal web UI.

import { useEffect, useState } from "react";
import { WalletButton } from "./components/WalletButton";
import { OrderForm } from "./components/OrderForm";
import { MyOrders } from "./components/MyOrders";
import { ActivityFeed } from "./components/ActivityFeed";
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { Hero } from "./components/Hero";
import { ToastProvider, useToasts } from "./lib/toast";
import { NETWORK, CONTRACTS, MATCHER_URL } from "./lib/config";
import { useWallet } from "./lib/wallet";
import { submitOrder, listMyOrders, listActivity } from "./lib/api";
import type { ActivityEntry, MyOrder, OrderPayload } from "./lib/types";

function Shell() {
  const wallet = useWallet();
  const toasts = useToasts();
  const [myOrders, setMyOrders] = useState<MyOrder[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const a = await listActivity();
        if (alive) setActivity(a);
      } catch { /* silent */ }
    };
    tick();
    const id = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!wallet.address) { setMyOrders([]); return; }
      try {
        const mine = await listMyOrders(wallet.address);
        if (alive) setMyOrders(mine);
      } catch { /* silent */ }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [wallet.address]);

  const onSubmit = async (params: {
    side: "BUY" | "SELL";
    amount: number;
    limit: number;
  }) => {
    if (!wallet.address) {
      toasts.push({ kind: "error", text: "Connect a wallet first." });
      return;
    }
    setSubmitting(true);
    try {
      // Random nonce client-side.
      const nonce = Math.floor(Math.random() * 1e15);
      const order: OrderPayload = {
        trader: wallet.address,
        side: params.side,
        pair_id: 42,                  // hardcoded demo pair
        amount: params.amount,
        limit_price: params.limit,
        nonce,
      };
      const { txHash } = await submitOrder(order);
      toasts.push({
        kind: "success",
        text: "Order committed",
        link: `${NETWORK.explorer}/tx/${txHash}`,
      });
      setTimeout(async () => {
        try {
          const mine = await listMyOrders(wallet.address!);
          setMyOrders(mine);
        } catch { /* silent */ }
      }, 2000);
    } catch (e: any) {
      toasts.push({ kind: "error", text: e?.message ?? "Commit failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen">
      <Header
        address={wallet.address}
        connectLabel={wallet.connectLabel}
        onConnect={() => wallet.connect()}
        onDisconnect={() => wallet.disconnect()}
      />

      <main className="mx-auto max-w-[720px] px-4 py-10 sm:py-14">
        <Hero />
        <section className="mt-10">
          <OrderForm onSubmit={onSubmit} submitting={submitting} disabled={!wallet.address} />
        </section>
        <section className="mt-10">
          <MyOrders orders={myOrders} />
        </section>
        <section className="mt-10">
          <ActivityFeed entries={activity} />
        </section>
      </main>

      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
