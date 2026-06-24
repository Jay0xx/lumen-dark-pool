// Wallets Kit integration.
//
// v1 supports any kit wallet (Freighter, xBull, Albedo, ...). For the demo
// the modal lets the user pick; if no kit is installed we show a friendly
// install hint.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
} from "@creit.tech/stellar-wallets-kit";

const kit = new StellarWalletsKit({
  network: WalletNetwork.TESTNET,
  modules: allowAllModules(),
});

export type WalletState = {
  address: string | null;
  connectLabel: string;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  kit: typeof kit;
};

export function useWallet(): WalletState {
  const [address, setAddress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { address: addr } = await kit.getAddress();
      setAddress(addr ?? null);
    } catch {
      setAddress(null);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Older kit versions don't expose a typed event listener; if present, use it
    // to refresh when the user switches accounts inside Freighter.
    const k = kit as unknown as {
      event?: { on?: (e: string, h: () => void) => void };
    };
    try {
      k.event?.on?.("addressChanged", refresh);
    } catch {
      // ignore - some kits don't support this
    }
    return () => {
      try {
        (kit as unknown as { event?: { removeAllListeners?: () => void } })
          .event?.removeAllListeners?.();
      } catch {
        // ignore
      }
    };
  }, [refresh]);

  const connect = useCallback(async () => {
    await kit.openModal({
      onWalletSelected: async () => {
        await refresh();
      },
    });
    await refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    try {
      await kit.disconnect();
    } catch {
      // some kits throw on disconnect - ignore
    }
    setAddress(null);
  }, []);

  const connectLabel = useMemo(() => {
    if (address) {
      return `${address.slice(0, 4)}\u2026${address.slice(-4)}`;
    }
    return "Connect wallet";
  }, [address]);

  return { address, connectLabel, connect, disconnect, kit };
}
