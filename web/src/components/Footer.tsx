import { BookOpen, Github } from "lucide-react";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-lumen-500/10 bg-lumen-surface/40">
      <div className="mx-auto flex max-w-[720px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-lumen-muted">
        <div className="flex items-center gap-3">
          <span>Lumen v0.1.0 \u00b7 Stellar public testnet</span>
          <a
            href="https://github.com/Jay0xx/lumen-dark-pool/blob/main/web/README.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-lumen-ink"
          >
            <BookOpen className="h-3 w-3" />
            How it works
          </a>
        </div>
        <a
          href="https://github.com/Jay0xx/lumen-dark-pool"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-lumen-ink"
        >
          <Github className="h-3 w-3" />
          github.com/Jay0xx/lumen-dark-pool
        </a>
      </div>
    </footer>
  );
}
