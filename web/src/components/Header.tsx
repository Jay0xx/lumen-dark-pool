import { Sparkles, ExternalLink } from "lucide-react";
import { WalletButton } from "./WalletButton";

export function Header({
  address,
  connectLabel,
  onConnect,
  onDisconnect,
}: {
  address: string | null;
  connectLabel: string;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  return (
    <header className="sticky top-0 z-20 backdrop-blur-md">
      <div className="mx-auto flex max-w-[720px] items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <div className="lumen-glow absolute inset-0 -z-10 h-6 w-6 rounded-full" />
            <Sparkles className="h-5 w-5 text-lumen-500" strokeWidth={2} />
          </div>
          <span className="text-lg font-semibold tracking-tight">Lumen</span>
          <span className="lumen-pill ml-1">Testnet</span>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="https://github.com/Jay0xx/lumen-dark-pool"
            target="_blank"
            rel="noreferrer"
            className="hidden text-xs font-medium text-lumen-muted hover:text-lumen-ink sm:inline-flex sm:items-center sm:gap-1"
            aria-label="Repository"
          >
            Repo
            <ExternalLink className="h-3 w-3" />
          </a>
          <WalletButton
            address={address}
            label={connectLabel}
            onConnect={onConnect}
            onDisconnect={onDisconnect}
          />
        </div>
      </div>
    </header>
  );
}
