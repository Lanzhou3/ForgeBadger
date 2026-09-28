import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

import {
  AuthenticationError,
  NotFoundError,
  ConflictError,
  ValidationError
} from "./errors.js";

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // The MCP endpoint speaks JSON-RPC, not the project envelope. Body-parser
  // failures (malformed JSON) surface here because parsing happens at app
  // level, before the /mcp router's own error handling can run.
  const requestPath = req.path ?? "";
  if (requestPath === "/mcp" || requestPath.startsWith("/mcp/")) {
    const isParseError = err instanceof SyntaxError;
    res.status(isParseError ? 400 : 500).json({
      jsonrpc: "2.0",
      error: {
        code: isParseError ? -32700 : -32603,
        message: isParseError ? "Parse error" : "Internal error"
      },
      id: null
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(422).json({
      code: 1,
      message: "Validation failed",
      details: err.issues
    });
    return;
  }

  if (err instanceof AuthenticationError) {
    res.status(401).json({ code: 1, message: "Unauthorized" });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({ code: 1, message: "Not found" });
    return;
  }

  if (err instanceof ConflictError) {
    res.status(409).json({ code: 1, message: "Conflict" });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(422).json({ code: 1, message: err.message || "Validation failed" });
    return;
  }

  const isDev = process.env.NODE_ENV === "development";
  const body: Record<string, unknown> = {
    code: 1,
    message: "Internal server error"
  };

  if (isDev && err.stack) {
    body.details = { stack: err.stack };
  }

  res.status(500).json(body);
}
