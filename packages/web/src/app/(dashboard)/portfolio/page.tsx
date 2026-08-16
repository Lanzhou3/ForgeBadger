"use client";

import { useSearchParams } from "next/navigation";

import { PortfolioWorkspace } from "@/components/portfolio/portfolio-workspace";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";

export default function PortfolioPage() {
  const { copy } = usePortfolioCopy();
  const searchParams = useSearchParams();
  const initialProjectId = normalizeProjectId(searchParams.get("projectId"));
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.pageDescription}</p>
      </div>
      <PortfolioWorkspace initialProjectId={initialProjectId} />
    </main>
  );
}

function normalizeProjectId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 && normalized.length <= 128 ? normalized : null;
}
