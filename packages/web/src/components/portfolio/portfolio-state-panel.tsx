import { AlertTriangle, FolderOpen, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { usePortfolioCopy } from "@/lib/portfolio-i18n";

interface PortfolioStatePanelProps {
  state: "loading" | "empty" | "error" | "conflict";
  message?: string;
  onRetry?: () => void;
}

export function PortfolioStatePanel({ state, message, onRetry }: PortfolioStatePanelProps) {
  const { copy } = usePortfolioCopy();
  const stateCopy = {
    loading: { title: copy.loadingTitle, description: copy.loadingDescription }, empty: { title: copy.emptyTitle, description: copy.emptyDescription },
    error: { title: copy.errorTitle, description: copy.errorDescription }, conflict: { title: copy.conflictTitle, description: copy.conflictDescription },
  } as const;
  const stateMessage = stateCopy[state];
  const Icon = state === "loading" ? LoaderCircle : state === "empty" ? FolderOpen : AlertTriangle;

  return (
    <Card className="of-animate-in">
      <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className={state === "loading" ? "size-5 animate-spin" : "size-5"} />
        </div>
        <div className="max-w-md">
          <div className="text-sm font-medium">{stateMessage.title}</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{message ?? stateMessage.description}</p>
        </div>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {copy.refresh}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
