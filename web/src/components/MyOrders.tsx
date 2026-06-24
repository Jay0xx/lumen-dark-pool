import { Check, Sparkles, ShieldCheck, ExternalLink, Hash, Lock } from "lucide-react";
import type { MyOrder } from "../lib/types";
import { NETWORK } from "../lib/config";

function shortAddr(a: string | null | undefined): string {
  if (!a) return "\u2014";
  if (a.length <= 10) return a;
  return `${a.slice(0, 6)}\u2026${a.slice(-4)}`;
}

function StatusChip({ status }: { status: MyOrder["status"] }) {
  if (status === "Committed") {
    return (
      <span className="lumen-pill inline-flex items-center gap-1">
        <Lock className="h-3 w-3" />
        Committed (hidden)
      </span>
    );
  }
  if (status === "Matched") {
    return (
      <span className="lumen-pill inline-flex items-center gap-1">
        <Sparkles className="h-3 w-3 text-lumen-500" />
        Matched (proof verified)
      </span>
    );
  }
  if (status === "Settled") {
    return (
      <span className="lumen-pill inline-flex items-center gap-1">
        <ShieldCheck className="h-3 w-3 text-lumen-success" />
        Settled
      </span>
    );
  }
  return <span className="lumen-pill inline-flex items-center gap-1">Failed</span>;
}

function OrderCard({ order }: { order: MyOrder }) {
  const explorer =
    order.settle_tx ? `${NETWORK.explorer}/tx/${order.settle_tx}` : null;
  return (
    <article className="lumen-card p-4 animate-fade-in">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="font-mono text-xs text-lumen-muted">
            <Hash className="mr-1 inline h-3 w-3" />
            {shortAddr(order.commitment)}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm font-medium">
            <span className={order.side === "BUY" ? "text-lumen-success" : "text-lumen-error"}>
              {order.side}
            </span>
            <span className="font-mono text-lumen-muted">{order.amount}</span>
            <span className="text-lumen-muted">@</span>
            <span className="font-mono text-lumen-muted">{order.limit_price}</span>
            <span className="text-lumen-muted">pair #{order.pair_id}</span>
          </div>
        </div>
        <StatusChip status={order.status} />
      </header>

      {/* 3-step progress strip */}
      <ol className="mt-3 flex items-center gap-2 text-xs">
        <Step done label="Committed" />
        <Connector done={order.status !== "Committed"} />
        <Step done={order.status === "Matched" || order.status === "Settled"} label="Matched" />
        <Connector done={order.status === "Settled"} />
        <Step done={order.status === "Settled"} label="Settled" />
      </ol>

      {explorer ? (
        <a
          href={explorer}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-lumen-600 hover:underline"
        >
          Settlement tx
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </article>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <li
      className={
        "lumen-progress-step " +
        (done ? "text-lumen-ink" : "text-lumen-muted")
      }
    >
      <span
        className={
          "flex h-4 w-4 items-center justify-center rounded-full " +
          (done ? "bg-lumen-500 text-white" : "border border-lumen-500/30 text-lumen-muted")
        }
      >
        {done ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
      </span>
      {label}
    </li>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <li aria-hidden className={"h-px flex-1 " + (done ? "bg-lumen-500" : "bg-lumen-500/20")} />
  );
}

export function MyOrders({ orders }: { orders: MyOrder[] }) {
  return (
    <section>
      <h2 className="text-base font-semibold">My orders</h2>
      {orders.length === 0 ? (
        <p className="mt-3 lumen-card p-6 text-center text-sm text-lumen-muted">
          No orders yet. Submit one to see the dark pool in action.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {orders.map((o) => (
            <li key={o.commitment}>
              <OrderCard order={o} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
