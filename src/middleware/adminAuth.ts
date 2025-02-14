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

export const validateAdminPassword = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const providedPassword = req.body.adminPassword ?? req.query.adminPassword;
  const requiredPassword = process.env.ADMIN_PASSWORD;

  if (!providedPassword || providedPassword.toString() !== requiredPassword) {
    res.status(401).json({ error: "Unauthorized - Invalid Password" });
    return;
  }

  next();
};
