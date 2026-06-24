import { useState } from "react";
import { ArrowRight } from "lucide-react";
import type { Side } from "../lib/types";

export function OrderForm({
  onSubmit,
  submitting,
  disabled,
}: {
  onSubmit: (params: { side: Side; amount: number; limit: number }) => void | Promise<void>;
  submitting: boolean;
  disabled: boolean;
}) {
  const [side, setSide] = useState<Side>("BUY");
  const [amount, setAmount] = useState<string>("100");
  const [limit, setLimit] = useState<string>("100");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = Number(amount);
    const l = Number(limit);
    if (!Number.isFinite(a) || a <= 0 || !Number.isInteger(a)) return;
    if (!Number.isFinite(l) || l <= 0 || !Number.isInteger(l)) return;
    onSubmit({ side, amount: a, limit: l });
  };

  return (
    <form
      onSubmit={submit}
      className="lumen-card relative overflow-hidden p-6"
      aria-label="Submit a new order"
    >
      {/* Subtle violet glow behind the active submit button */}
      <div aria-hidden className="lumen-glow pointer-events-none absolute -bottom-12 right-8 -z-10 h-40 w-40 rounded-full" />

      <h2 className="text-base font-semibold">Submit order</h2>

      <div className="mt-4 inline-flex rounded-full border border-lumen-500/20 bg-lumen-50/50 p-0.5 text-sm">
        {(["BUY", "SELL"] as Side[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSide(s)}
            aria-pressed={side === s}
            className={
              "rounded-full px-4 py-1 transition-colors " +
              (side === s
                ? "bg-lumen-500 text-white shadow"
                : "text-lumen-muted hover:text-lumen-ink")
            }
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs font-medium text-lumen-muted">Amount (base)</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled || submitting}
            className="lumen-card mt-1 w-full bg-lumen-surface px-3 py-2 font-mono text-sm focus:border-lumen-500/60 disabled:opacity-50"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-lumen-muted">Limit price (quote / base)</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            disabled={disabled || submitting}
            className="lumen-card mt-1 w-full bg-lumen-surface px-3 py-2 font-mono text-sm focus:border-lumen-500/60 disabled:opacity-50"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={disabled || submitting}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-lumen-500 px-5 py-2.5 text-sm font-medium text-white shadow-lumen transition-colors hover:bg-lumen-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Submitting\u2026" : "Submit privately"}
        {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
      </button>

      <p className="mt-3 text-center text-xs text-lumen-muted">
        Your order is committed as a hash. No one sees it until it&apos;s matched.
      </p>
    </form>
  );
}
