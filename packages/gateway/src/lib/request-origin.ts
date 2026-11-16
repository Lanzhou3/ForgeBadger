import type { Request } from "express";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * True only for a request made straight to the loopback listener. Anything
 * that arrived through a proxy carries a forwarding header and is treated as
 * remote, even though its socket peer is the local proxy — so a reverse proxy
 * in front of the Gateway never inherits local-operator privileges.
 */
export function isDirectLoopbackRequest(req: Request): boolean {
  if (req.headers.forwarded || req.headers["x-forwarded-for"] || req.headers["x-real-ip"]) {
    return false;
  }
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress?.toLowerCase() ?? "");
}
