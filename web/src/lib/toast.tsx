// Minimal toast system. Toasts are stacked top-right, auto-dismiss after 4s.
//
// (A real app would pull in shadcn/ui <Sonner> or similar; for the demo a
// purpose-built hook is plenty.)

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";

export type ToastKind = "info" | "success" | "warning" | "error";
export type Toast = {
  id: string;
  kind: ToastKind;
  text: string;
  /** Optional external link (e.g. tx-explorer URL). */
  link?: string;
  /** Auto-dismiss after this many ms; default 4000. */
  ttl?: number;
};

type Ctx = {
  push(t: Omit<Toast, "id">): void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${idRef.current++}`;
    const ttl = t.ttl ?? 4000;
    setToasts((prev) => [...prev, { id, ...t }]);
    if (ttl > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, ttl);
    }
  }, []);

  const dismiss = (id: string) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToasts(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToasts() must be used inside <ToastProvider>");
  return ctx;
}

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const { kind, text, link, ttl } = toast;
  const palette =
    kind === "success" ? "border-lumen-success/40 bg-lumen-success/5 text-lumen-ink"
    : kind === "error"   ? "border-lumen-error/40   bg-lumen-error/5   text-lumen-ink"
    : kind === "warning" ? "border-lumen-warning/40 bg-lumen-warning/5 text-lumen-ink"
    :                     "border-lumen-500/30     bg-lumen-500/5     text-lumen-ink";
  const Icon =
    kind === "success" ? CheckCircle2
    : kind === "error"   ? XCircle
    : kind === "warning" ? AlertTriangle
    :                     Info;
  const iconColor =
    kind === "success" ? "text-lumen-success"
    : kind === "error"   ? "text-lumen-error"
    : kind === "warning" ? "text-lumen-warning"
    :                     "text-lumen-500";
  return (
    <div
      role="status"
      aria-live={kind === "error" ? "assertive" : "polite"}
      className={
        "lumen-card pointer-events-auto flex items-start gap-3 border px-3 py-2 text-sm shadow-lumen-lg animate-fade-in " +
        palette
      }
    >
      <Icon className={"mt-0.5 h-4 w-4 shrink-0 " + iconColor} />
      <div className="flex-1">
        <div>{text}</div>
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="mt-0.5 inline-block text-xs font-medium text-lumen-600 underline-offset-2 hover:underline"
          >
            View on Stellar Expert →
          </a>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="ml-1 rounded-md p-0.5 text-lumen-muted hover:bg-lumen-ink/5"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
