import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { isCanceledOrderNotes } from "../services/order-cancellation.service";
import { derivePublicTrackingStatus } from "../services/public-tracking.service";

export async function getPublicOrderTracking(req: Request, res: Response) {
  res.set("Cache-Control", "no-store");

  const token = typeof req.params.token === "string" ? req.params.token : "";
  if (!token) return res.status(404).json({ error: "Pedido no encontrado" });

  try {
    const order = await prisma.order.findUnique({
      where: { publicTrackingToken: token },
      select: {
        id: true,
        stage: true,
        shippingType: true,
        estimatedReadyAt: true,
        createdAt: true,
        notes: true,
      },
    });

    if (!order || isCanceledOrderNotes(order.notes)) {
      return res.status(404).json({ error: "Pedido no encontrado" });
    }

    const publicStatus = derivePublicTrackingStatus(order);
    const includesEstimate = publicStatus === "REGISTERED" || publicStatus === "IN_PRODUCTION";

    return res.json({
      orderNumber: order.id,
      publicStatus,
      shippingType: order.shippingType,
      estimatedReadyAt: includesEstimate ? order.estimatedReadyAt?.toISOString() ?? null : null,
      createdAt: order.createdAt.toISOString(),
    });
  } catch (error) {
    console.error(
      "Error consultando tracking público",
      error instanceof Error ? error.name : "UnknownError"
    );
    return res.status(404).json({ error: "Pedido no encontrado" });
  }
}
