/**
 * Detect SQLite foreign-key constraint violations so routes can map them to
 * HTTP 409 instead of leaking a 500 with an internal error string.
 */
export function isForeignKeyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("foreign key constraint failed") ||
    message.includes("constraint failed") ||
    message.includes("sqlite_error") && message.includes("constraint")
  );
}