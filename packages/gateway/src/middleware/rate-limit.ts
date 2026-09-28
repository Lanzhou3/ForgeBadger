import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyFn?: (req: Request) => string;
}

export interface RateLimiterMiddleware {
  (req: Request, res: Response, next: NextFunction): void;
  reset(key?: string): void;
}

/**
 * Tiny in-memory sliding-window rate limiter suitable for guarding
 * credential-bearing endpoints (login, register, API key rotation, probe
 * endpoints). Uses a Map of arrays per key; bounded by periodic pruning so the
 * memory footprint is O(active clients) not O(total requests).
 *
 * NOT cluster-safe — for multi-instance deployments, swap in a Redis-backed
 * implementation. The contract (`keyFn` returning a stable client id) makes
 * that swap straightforward.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiterMiddleware {
  const { windowMs, maxRequests, keyFn = defaultKey } = options;
  const buckets = new Map<string, number[]>();

  function prune(now: number): void {
    const cutoff = now - windowMs;
    for (const [key, timestamps] of buckets) {
      const filtered = timestamps.filter((timestamp) => timestamp > cutoff);
      if (filtered.length === 0) {
        buckets.delete(key);
      } else {
        buckets.set(key, filtered);
      }
    }
  }

  // Periodically prune so the map does not grow unbounded under churn.
  const pruneInterval = setInterval(() => prune(Date.now()), windowMs);
  pruneInterval.unref?.();

  function middleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = keyFn(req);
    const timestamps = buckets.get(key) ?? [];
    const recent = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= maxRequests) {
      const oldest = recent[0] ?? now;
      const retryAfterMs = windowMs - (now - oldest);
      res.setHeader("Retry-After", Math.max(1, Math.ceil(retryAfterMs / 1000)));
      res.status(429).json({ code: 1, message: "Too many requests" });
      return;
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  }

  middleware.reset = (key?: string): void => {
    if (key === undefined) {
      buckets.clear();
    } else {
      buckets.delete(key);
    }
  };

  return middleware;
}

function defaultKey(req: Request): string {
  // Prefer an authenticated user id when present so rate limits stay per-user;
  // fall back to the remote address for pre-auth endpoints like /login.
  const userId = (req as Request & { userId?: string }).userId;
  if (typeof userId === "string" && userId.length > 0) {
    return `user:${userId}`;
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return `ip:${forwarded.split(",")[0]?.trim() ?? "unknown"}`;
  }
  return `ip:${req.ip ?? req.socket?.remoteAddress ?? "unknown"}`;
}