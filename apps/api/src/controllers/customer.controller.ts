import type { Request, Response } from "express";
import { prisma } from "../lib/prisma";

function normalizePhone(input: string) {
  const digits = (input ?? "").replace(/\D/g, "");
  // México: si viene con +52 o 52, nos quedamos con los últimos 10
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// POST /customers  (registro)
export async function createCustomer(req: Request, res: Response) {
  try {
    const { name, phone } = req.body as { name: string; phone: string };

    const cleanName = (name ?? "").trim();
    const cleanPhone = normalizePhone(phone);

    if (!cleanName) return res.status(400).json({ error: "name es requerido" });
    if (cleanPhone.length !== 10) return res.status(400).json({ error: "phone inválido (10 dígitos)" });

    // Si ya existe por teléfono, devolvemos el existente (sin duplicar)
    const existing = await prisma.customer.findUnique({
      where: { phone: cleanPhone },
      select: { id: true, name: true },
    });

    if (existing) {
      // opcional: si cambió el nombre, lo actualizamos
      if (cleanName !== existing.name) {
        await prisma.customer.update({
          where: { id: existing.id },
          data: { name: cleanName },
        });
      }
      return res.status(200).json({ customerId: existing.id, isNew: false });
    }

    const created = await prisma.customer.create({
      data: { name: cleanName, phone: cleanPhone },
      select: { id: true },
    });

    return res.status(201).json({ customerId: created.id, isNew: true });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Error creando cliente" });
  }
}

// GET /customers/:id  (consultar por número de cliente)
export async function getCustomerById(req: Request, res: Response) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });

    const customer = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, phone: true, createdAt: true },
    });

    if (!customer) return res.status(404).json({ error: "Cliente no existe" });

    return res.json(customer);
  } catch (e: any) {
    return res.status(400).json({ error: e?.message ?? "Error consultando cliente" });
  }
}
