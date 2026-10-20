"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUser,
  setToken,
  setUser,
  isAuthenticated,
  logout as doLogout,
} from "@/lib/auth";
import {
  GatewayApiError,
  login as apiLogin,
  register as apiRegister,
  getMe,
} from "@/lib/api";

export function useAuth() {
  const queryClient = useQueryClient();
  // The placeholder below must only apply after hydration: the server render
  // has no localStorage (no token, no cached user), so applying it on the
  // first client render would diverge from the server HTML and trip React's
  // hydration-mismatch recovery.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { data: user, isLoading, isFetching } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      if (!isAuthenticated()) return null;
      const cached = getUser();
      // Always validate against the server: a locally cached user must never
      // mask an expired/revoked token. Keep it only as a transient-outage
      // fallback; explicit auth rejection still clears the local session.
      try {
        const result = await getMe();
        if (result.code === 0 && result.data) {
          setUser(result.data);
          return result.data;
        }
      } catch (error) {
        if (!isAuthenticationRejection(error)) {
          return cached;
        }
      }
      doLogout();
      return null;
    },
    // Paint the console instantly with the locally cached user while the
    // server validation above runs in the background. placeholderData never
    // lands in the cache and the queryFn still runs, so an expired token is
    // still rejected on the same pass (user flips to null and the layout
    // redirects to /login). Without a cached user there is no placeholder and
    // the loading gate behaves as before.
    placeholderData: () => (mounted && isAuthenticated() ? (getUser() ?? undefined) : undefined),
    staleTime: 5 * 60 * 1000,
  });

  const loginMutation = useMutation({
    mutationFn: async (vars: { email: string; password: string }) =>
      apiLogin(vars.email, vars.password),
    onSuccess: (data) => {
      if (data.code === 0 && data.data) {
        setToken(data.data.token);
        setUser(data.data.user);
        queryClient.setQueryData(["auth", "me"], data.data.user);
      }
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (vars: { email: string; password: string; recoveryKey: string; inviteCode?: string }) =>
      apiRegister(vars.email, vars.password, vars.recoveryKey, vars.inviteCode),
    onSuccess: (data) => {
      if (data.code === 0 && data.data) {
        setToken(data.data.token);
        setUser(data.data.user);
        queryClient.setQueryData(["auth", "me"], data.data.user);
      }
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => doLogout(),
    onSuccess: () => {
      queryClient.setQueryData(["auth", "me"], null);
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  return {
    user,
    isLoading,
    isFetching,
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
  };
}

function isAuthenticationRejection(error: unknown): boolean {
  return error instanceof GatewayApiError && (error.status === 401 || error.status === 403);
}
