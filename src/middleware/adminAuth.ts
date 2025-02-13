import { Request, Response, NextFunction } from "express";

export const validateAdminPin = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const providedPin = req.body.adminPIN ?? req.query.adminPIN;
  const requiredPin = process.env.ADMIN_PIN;

  if (!providedPin || providedPin.toString() !== requiredPin) {
    res.status(401).json({ error: "Unauthorized - Invalid PIN" });
    return;
  }

  next();
};
