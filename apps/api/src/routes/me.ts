import { Router } from "express";
import { prisma } from "../lib/prisma";
import { auth, type AuthedRequest } from "../middlewares/auth";

const router = Router();

router.get("/", auth, async (req: AuthedRequest, res) => {
  const userId = req.auth!.userId;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, branchId: true },
  });

  res.json({ user });
});

export default router;
