import jwt from "jsonwebtoken";

export function signJwt(payload: { userId: string; email: string }, secret: string): string {
  return jwt.sign(payload, secret, { algorithm: "HS256", expiresIn: "7d" });
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
