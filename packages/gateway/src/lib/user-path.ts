import { homedir } from "node:os";
import path from "node:path";

type PathJoiner = Pick<typeof path, "join">;

/** Expands only a leading user-home marker; all other paths remain untouched. */
export function expandUserPath(
  value: string,
  homeDir = homedir(),
  pathApi: PathJoiner = path
): string {
  if (value === "~") return homeDir;
  if (!value.startsWith("~/") && !value.startsWith("~\\")) return value;

  const relativeParts = value.slice(2).split(/[\\/]+/u).filter(Boolean);
  return pathApi.join(homeDir, ...relativeParts);
}
