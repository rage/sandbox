import { Request, Response } from "express";

/**
 * GET /
 */
export const index = (req: Request, res: Response) => {
  res.json({ message: "Hello!" });
};
