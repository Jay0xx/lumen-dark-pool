export function Hero() {
  return (
    <section className="relative">
      {/* Soft violet glow behind the hero card. */}
      <div aria-hidden className="lumen-glow pointer-events-none absolute -inset-6 -z-10" />
      <div className="lumen-card relative px-6 py-7">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Trade without revealing your orders.
        </h1>
        <p className="mt-1.5 text-sm text-lumen-muted">
          Zero-knowledge dark pool, settled on Stellar.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-lumen-muted">
          <span className="rounded-full border border-lumen-500/30 bg-lumen-50 px-2 py-0.5 font-medium text-lumen-700">
            🔒 Hidden until matched
          </span>
          <span className="rounded-full border border-lumen-500/30 bg-lumen-50 px-2 py-0.5 font-medium text-lumen-700">
            ✨ Proof-verified match
          </span>
          <span className="rounded-full border border-lumen-500/30 bg-lumen-50 px-2 py-0.5 font-medium text-lumen-700">
            ✅ Atomic settlement
          </span>
        </div>
      </div>
    </section>
  );
}
