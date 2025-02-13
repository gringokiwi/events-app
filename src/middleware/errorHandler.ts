import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation error",
      details: err.errors,
    });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
