import jwt from "jsonwebtoken";

/**
 * Access tokens are short-lived: the web console clears the session and
 * returns to /login on the first 401, so a 24h window bounds token-theft
 * exposure without making active users re-authenticate mid-day.
 */
const ACCESS_TOKEN_TTL = "24h";

export function signJwt(payload: { userId: string; email: string }, secret: string): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: ACCESS_TOKEN_TTL });
}

export function verifyJwt(token: string, secret: string): { userId: string; email: string } {
  const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("Invalid JWT payload");
  }
  const payload = decoded as Record<string, unknown>;
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    throw new Error("Invalid JWT payload");
  }
  return { userId: payload.userId, email: payload.email };
}

export function decodeJwt(token: string): { userId: string; email: string } | null {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object") return null;
  const payload = decoded as Record<string, unknown>;
  if (typeof payload.userId !== "string" || typeof payload.email !== "string") {
    return null;
  }
  return { userId: payload.userId, email: payload.email };
}
