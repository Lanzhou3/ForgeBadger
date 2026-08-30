"use client";

import { useEffect, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";

import {
  searchProjectGraphSymbols,
  type GraphSymbolRef
} from "@/lib/api";
import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";

export interface SymbolSearchBoxProps {
  projectId: string;
  enabled: boolean;
  onSelect: (symbol: GraphSymbolRef) => void;
}

/**
 * Debounced symbol search over the project's CodeGraph index (FTS5-backed).
 * Results are plain references; selection is handled by the parent panel.
 */
export function SymbolSearchBox({ projectId, enabled, onSelect }: SymbolSearchBoxProps) {
  const { t } = useLanguage();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    const onOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutsideClick);
    return () => document.removeEventListener("mousedown", onOutsideClick);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["project-graph", "search", projectId, debounced],
    queryFn: () => searchProjectGraphSymbols(projectId, { q: debounced, limit: 12 }),
    enabled: enabled && debounced.length > 0,
  });

  const symbols = data && data.available ? data.symbols : [];

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t("projects.graphSearchPlaceholder")}
        className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {isFetching && (
        <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}
      {open && debounced.length > 0 && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-md border border-border bg-card shadow-lg">
          {symbols.length === 0 ? (
            <div className="px-3 py-2.5 text-xs text-muted-foreground">{t("projects.graphNoResults")}</div>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {symbols.map((symbol) => (
                <li key={symbol.id}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors",
                      "hover:bg-muted/60"
                    )}
                    onClick={() => {
                      onSelect(symbol);
                      setOpen(false);
                    }}
                  >
                    <span className="font-mono text-xs font-medium">{symbol.name}</span>
                    <span className="truncate text-[10px] text-muted-foreground">
                      {symbol.kind} · {symbol.filePath}:{symbol.startLine}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
