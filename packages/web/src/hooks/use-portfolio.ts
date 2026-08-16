"use client";

import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createPortfolioRequest,
  getPortfolioRequestTimeline,
  getPortfolioWorkspaceProjection,
  portfolioQueryKeys,
  resolvePortfolioOwnerDecision,
  updatePortfolioHeartbeat,
  type CreatePortfolioRequestInput,
  type PortfolioHeartbeatInput,
  type PortfolioOwnerDecisionInput,
} from "@/lib/portfolio-api";

export function usePortfolioWorkspaceProjection() {
  return useQuery({
    queryKey: portfolioQueryKeys.projection,
    queryFn: getPortfolioWorkspaceProjection,
  });
}

export function usePortfolioRequestTimeline(requestId: string | null) {
  return useQuery({
    queryKey: portfolioQueryKeys.timeline(requestId ?? "none"),
    queryFn: () => getPortfolioRequestTimeline(requestId ?? ""),
    enabled: Boolean(requestId),
  });
}

export function usePortfolioRequestSubmission() {
  return usePortfolioIdempotentMutation(createPortfolioRequest);
}

export function usePortfolioOwnerDecision() {
  return usePortfolioIdempotentMutation(resolvePortfolioOwnerDecision);
}

export function usePortfolioHeartbeatUpdate() {
  return usePortfolioIdempotentMutation(updatePortfolioHeartbeat);
}

function usePortfolioIdempotentMutation<TInput, TResult>(
  mutationFn: (input: TInput, options: { idempotencyKey: string }) => Promise<TResult>
) {
  const queryClient = useQueryClient();
  const idempotencyKeyRef = useRef<string | null>(null);
  const failedInputRef = useRef<TInput | null>(null);
  const mutation = useMutation({
    mutationFn: async (input: TInput) => {
      const idempotencyKey = idempotencyKeyRef.current ?? createIdempotencyKey();
      idempotencyKeyRef.current = idempotencyKey;
      return mutationFn(input, { idempotencyKey });
    },
    onSuccess: () => {
      idempotencyKeyRef.current = null;
      failedInputRef.current = null;
      void queryClient.invalidateQueries({ queryKey: portfolioQueryKeys.root });
    },
    onError: (_error, input) => {
      failedInputRef.current = input;
    },
  });

  /** A new chat message gets a fresh key; the retry path deliberately keeps its original key. */
  const submit = useCallback((input: TInput, options?: Parameters<typeof mutation.mutate>[1]) => {
    if (failedInputRef.current !== input) {
      idempotencyKeyRef.current = null;
      mutation.reset();
    }
    mutation.mutate(input, options);
  }, [mutation]);
  const retry = useCallback((input: TInput, options?: Parameters<typeof mutation.mutate>[1]) => mutation.mutate(input, options), [mutation]);
  return { ...mutation, submit, retry };
}

function createIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `portfolio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
