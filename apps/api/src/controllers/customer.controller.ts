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
// customer.controller.ts - Agrega esta función

// GET /customers/search?q=termino
export async function searchCustomers(req: Request, res: Response) {
  try {
    const { q } = req.query;
    
    if (!q || typeof q !== 'string' || q.trim() === '') {
      return res.json([]);
    }
    
    const searchTerm = q.trim();
    
    // Construir las condiciones de búsqueda
    const orConditions: any[] = [];
    
    // Buscar por nombre (insensible a mayúsculas)
    orConditions.push({
      name: {
        contains: searchTerm,
        mode: 'insensitive'
      }
    });
    
    // Buscar por teléfono
    orConditions.push({
      phone: {
        contains: searchTerm,
        mode: 'insensitive'
      }
    });
    
    // Buscar por ID si el término es un número
    const idNumber = parseInt(searchTerm);
    if (!isNaN(idNumber)) {
      orConditions.push({
        id: idNumber
      });
    }
    
    const customers = await prisma.customer.findMany({
      where: {
        OR: orConditions
      },
      take: 20, // Limitar a 20 resultados
      orderBy: {
        name: 'asc'
      },
      select: {
        id: true,
        name: true,
        phone: true
      }
    });
    
    return res.json(customers);
  } catch (e: any) {
    console.error('Error searching customers:', e);
    return res.status(500).json({ error: e?.message ?? "Error buscando clientes" });
  }
}