export type LibraryVisibility = "private" | "shared" | "admin";
export type VisibilityFilter = LibraryVisibility | "all";

export const visibilityOptions: LibraryVisibility[] = ["private", "shared", "admin"];

export function normalizeVisibility(value: unknown): LibraryVisibility {
  return visibilityOptions.includes(value as LibraryVisibility)
    ? (value as LibraryVisibility)
    : "private";
}

export function visibilityLabelKey(visibility: LibraryVisibility): `visibility.${LibraryVisibility}` {
  return `visibility.${visibility}`;
}

export function visibilityDescriptionKey(
  visibility: LibraryVisibility
): `visibility.${LibraryVisibility}Description` {
  return `visibility.${visibility}Description`;
}

export function filterByVisibility<T extends { visibility?: unknown }>(
  records: T[],
  filter: VisibilityFilter
): T[] {
  if (filter === "all") return records;
  return records.filter((record) => normalizeVisibility(record.visibility) === filter);
}
