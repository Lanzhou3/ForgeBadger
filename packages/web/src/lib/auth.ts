import {
  readMigratedStorageValue,
  removeMigratedStorageValue,
  writeMigratedStorageValue,
} from "./brand-storage";

const TOKEN_KEY = "forgebadger.token";
const USER_KEY = "forgebadger.user";
const LEGACY_TOKEN_KEY = "openforge.token";
const LEGACY_USER_KEY = "openforge.user";

export interface User {
  id: string;
  email: string;
  role?: "admin" | "user" | string;
  status?: "active" | "disabled" | string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return readMigratedStorageValue(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY);
}

export function setToken(token: string): void {
  writeMigratedStorageValue(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY, token);
}

export function clearToken(): void {
  removeMigratedStorageValue(localStorage, TOKEN_KEY, LEGACY_TOKEN_KEY);
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  const raw = readMigratedStorageValue(localStorage, USER_KEY, LEGACY_USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setUser(user: User): void {
  writeMigratedStorageValue(localStorage, USER_KEY, LEGACY_USER_KEY, JSON.stringify(user));
}

export function clearUser(): void {
  removeMigratedStorageValue(localStorage, USER_KEY, LEGACY_USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

export function logout(): void {
  clearToken();
  clearUser();
}
