"use client";

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

  const { data: user, isLoading } = useQuery({
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
    mutationFn: async (vars: { email: string; password: string }) =>
      apiRegister(vars.email, vars.password),
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
    isAuthenticated: !!user,
    login: loginMutation.mutateAsync,
    register: registerMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
  };
}

function isAuthenticationRejection(error: unknown): boolean {
  return error instanceof GatewayApiError && (error.status === 401 || error.status === 403);
}
