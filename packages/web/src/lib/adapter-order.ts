import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { getAdapterOrder } from "@/lib/api";

export const ADAPTER_ORDER_QUERY_KEY = ["adapter-order"] as const;

/**
 * Orders adapters by the user's saved preference: preferred ids first (in
 * preference order), anything not in the preference appended in its original
 * discovery order — so adapters added after the preference was saved (e.g. a
 * newly released CLI) still show up, at the end.
 */
export function orderAdapters<T extends { id: string }>(
  adapters: readonly T[],
  order: readonly string[]
): T[] {
  if (order.length === 0) return [...adapters];
  const rank = new Map(order.map((id, index) => [id, index]));
  return [...adapters].sort((a, b) => {
    const rankA = rank.get(a.id) ?? order.length;
    const rankB = rank.get(b.id) ?? order.length;
    return rankA - rankB;
  });
}

/** Applies the saved CLI display order to a discovery list. */
export function useOrderedAdapters<T extends { id: string }>(adapters: readonly T[]): T[] {
  const { data } = useQuery({
    queryKey: ADAPTER_ORDER_QUERY_KEY,
    queryFn: getAdapterOrder,
    staleTime: 60_000,
  });
  const order = data?.order;
  return useMemo(() => orderAdapters(adapters, order ?? []), [adapters, order]);
}
