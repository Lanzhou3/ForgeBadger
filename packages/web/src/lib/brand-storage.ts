export interface BrandStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

/**
 * Reads a ForgeBadger browser preference while performing a one-time migration
 * from its OpenForge key. The new key always wins when both are present.
 */
export function readMigratedStorageValue(
  storage: BrandStorage,
  key: string,
  legacyKey: string
): string | null {
  const value = storage.getItem(key);
  if (value !== null) {
    storage.removeItem?.(legacyKey);
    return value;
  }

  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return null;

  storage.setItem(key, legacyValue);
  storage.removeItem?.(legacyKey);
  return legacyValue;
}

export function writeMigratedStorageValue(
  storage: BrandStorage,
  key: string,
  legacyKey: string,
  value: string
): void {
  storage.setItem(key, value);
  storage.removeItem?.(legacyKey);
}

export function removeMigratedStorageValue(
  storage: BrandStorage,
  key: string,
  legacyKey: string
): void {
  storage.removeItem?.(key);
  storage.removeItem?.(legacyKey);
}
