import { Wallet, LogOut } from "lucide-react";

export function WalletButton({
  address,
  label,
  onConnect,
  onDisconnect,
}: {
  address: string | null;
  label: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  if (address) {
    return (
      <div className="flex items-center gap-1">
        <span className="lumen-card inline-flex items-center gap-2 px-3 py-1.5 font-mono text-xs">
          <span className="h-1.5 w-1.5 rounded-full bg-lumen-success" />
          {label}
        </span>
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
          className="rounded-full p-1.5 text-lumen-muted hover:bg-lumen-ink/5 hover:text-lumen-ink"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onConnect}
      className="lumen-card inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-lumen-ink hover:border-lumen-500/40"
    >
      <Wallet className="h-3.5 w-3.5 text-lumen-500" />
      {label}
    </button>
  );
}
