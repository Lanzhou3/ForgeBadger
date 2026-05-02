import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

import { ValidationError } from "./errors.js";

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      next(new ValidationError(parseResult.error.message));
      return;
    }
    next();
  };
}
