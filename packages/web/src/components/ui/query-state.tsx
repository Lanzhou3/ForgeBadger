"use client";

import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useLanguage } from "@/hooks/use-language";

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  /** True when the query succeeded and there is nothing to show. */
  isEmpty: boolean;
  /** Retries the failed query; the error state renders a retry button when set. */
  onRetry?: () => void;
  /**
   * Loading placeholder. Defaults to a centered spinner line; pass `null` to
   * render nothing (e.g. when a child component renders its own skeleton).
   */
  loading?: ReactNode;
  /** Empty state; keep each page's existing copy. */
  empty: ReactNode;
  /** Error state; defaults to the shared load-failed copy plus the retry button. */
  error?: ReactNode;
  /** Content rendered only when the query succeeded with data. */
  children?: ReactNode;
}

/**
 * Unified loading / error / empty tri-state for query-driven sections. Pages
 * keep their own empty (and optionally loading) copy; the error state is
 * standardized so a failed fetch never masquerades as an empty list.
 */
export function QueryState({
  isLoading,
  isError,
  isEmpty,
  onRetry,
  loading,
  empty,
  error,
  children,
}: QueryStateProps) {
  const { t } = useLanguage();
  if (isLoading) {
    if (loading !== undefined) return <>{loading}</>;
    return (
      <Card className="forgebadger-animate-in">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {t("common.loading")}
        </CardContent>
      </Card>
    );
  }
  if (isError) {
    if (error !== undefined) return <>{error}</>;
    return (
      <Card className="forgebadger-animate-in">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <div className="text-sm font-medium">{t("common.loadFailedTitle")}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("common.loadFailedDescription")}
            </p>
          </div>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }
  if (isEmpty) return <>{empty}</>;
  return <>{children}</>;
}
