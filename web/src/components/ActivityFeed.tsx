import { ExternalLink } from "lucide-react";
import type { ActivityEntry } from "../lib/types";
import { NETWORK } from "../lib/config";

function shortHash(h: string): string {
  if (h.length <= 12) return h;
  return `${h.slice(0, 8)}\u2026${h.slice(-4)}`;
}

function timeAgo(unixSeconds: number): string {
  const ms = Date.now() - unixSeconds * 1000;
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  return (
    <section>
      <h2 className="text-base font-semibold">Activity</h2>
      {entries.length === 0 ? (
        <p className="mt-3 lumen-card p-6 text-center text-sm text-lumen-muted">
          No settled matches yet. The matcher fills this in within a few seconds
          of a successful settle.
        </p>
      ) : (
        <ul className="mt-3 lumen-card divide-y divide-lumen-500/10 text-sm">
          {entries.map((e) => (
            <li key={e.tx} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <div className="font-mono text-xs text-lumen-muted">
                  pair #{e.pair_id} \u00b7 {timeAgo(e.ts)}
                </div>
                <div className="mt-0.5 truncate font-mono text-xs">
                  fill {e.fill_amount} @ price {e.clearing_price}
                </div>
              </div>
              <a
                href={`${NETWORK.explorer}/tx/${e.tx}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-lumen-600 hover:underline"
              >
                {shortHash(e.tx)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
