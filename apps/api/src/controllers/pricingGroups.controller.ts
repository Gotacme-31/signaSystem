import type { Response } from "express";
import type { UnitType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { AuthedRequest } from "../middlewares/auth";
import { validatePricingGroupMembers } from "../services/order-pricing.service";
import {
  archivePricingGroup as archivePricingGroupTransaction,
  hardDeleteUnusedPricingGroup,
  PRICING_GROUP_PRODUCT_WHERE,
  PricingGroupHasHistoryError,
  PricingGroupNotFoundError,
} from "../services/pricing-groups-admin.service";

function parseGroupId(value: string | string[] | undefined) {
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeName(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUnitType(value: unknown): UnitType | null {
  return value === "METER" || value === "PIECE" ? value : null;
}

function parseProductIds(value: unknown, fallback: number[] | null) {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) throw new Error("productIds debe ser un arreglo");
  if (value.some((id) => typeof id !== "number" || !Number.isInteger(id) || id <= 0)) {
    throw new Error("productIds solo puede contener enteros positivos");
  }
  if (new Set(value).size !== value.length) {
    throw new Error("productIds no puede contener duplicados");
  }
  return value as number[];
}

function parseIsActive(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error("isActive debe ser booleano");
  return value;
}

async function validateProducts(productIds: number[], unitType: UnitType) {
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      name: true,
      unitType: true,
      isCustomProductTemplate: true,
      pricingGroupId: true,
    },
  });

  return products;
}

const groupInclude = {
  products: {
    select: {
      id: true,
      name: true,
      unitType: true,
      isActive: true,
    },
    orderBy: { name: "asc" as const },
  },
  _count: { select: { appliedOrderItems: true } },
};

export async function listPricingGroups(_req: AuthedRequest, res: Response) {
  try {
    const groups = await prisma.pricingGroup.findMany({
      include: groupInclude,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    res.json({ groups });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Error listando grupos" });
  }
}

export async function listPricingGroupProducts(_req: AuthedRequest, res: Response) {
  try {
    const products = await prisma.product.findMany({
      where: PRICING_GROUP_PRODUCT_WHERE,
      select: {
        id: true,
        name: true,
        unitType: true,
        isActive: true,
        pricingGroupId: true,
        pricingGroup: { select: { id: true, name: true } },
      },
      orderBy: { name: "asc" },
    });
    res.json({ products });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Error listando productos" });
  }
}

export async function createPricingGroup(req: AuthedRequest, res: Response) {
  try {
    const name = normalizeName(req.body?.name);
    const unitType = normalizeUnitType(req.body?.unitType);
    const productIds = parseProductIds(req.body?.productIds, [])!;
    const isActive = parseIsActive(req.body?.isActive, true);

    if (!name) return res.status(400).json({ error: "Nombre requerido" });
    if (!unitType) return res.status(400).json({ error: "Unidad inválida" });

    const products = await validateProducts(productIds, unitType);
    validatePricingGroupMembers({ products, requestedProductIds: productIds, unitType });

    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.pricingGroup.create({
        data: { name, unitType, isActive },
      });
      if (productIds.length > 0) {
        const assigned = await tx.product.updateMany({
          where: {
            id: { in: productIds },
            pricingGroupId: null,
            unitType,
            isCustomProductTemplate: false,
          },
          data: { pricingGroupId: created.id },
        });
        if (assigned.count !== productIds.length) {
          throw new Error("Uno o más productos ya pertenecen a otro grupo");
        }
      }
      return tx.pricingGroup.findUnique({ where: { id: created.id }, include: groupInclude });
    });

    res.status(201).json({ group });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Error creando grupo" });
  }
}

export async function updatePricingGroup(req: AuthedRequest, res: Response) {
  try {
    const groupId = parseGroupId(req.params.id);
    if (!groupId) return res.status(400).json({ error: "ID inválido" });

    const existing = await prisma.pricingGroup.findUnique({
      where: { id: groupId },
      select: { id: true, name: true, unitType: true },
    });
    if (!existing) return res.status(404).json({ error: "Grupo no encontrado" });

    const name = req.body?.name === undefined ? existing.name : normalizeName(req.body.name);
    const unitType = req.body?.unitType === undefined
      ? existing.unitType
      : normalizeUnitType(req.body.unitType);
    const productIds = parseProductIds(req.body?.productIds, null);
    const isActive = parseIsActive(req.body?.isActive, true);

    if (!name) return res.status(400).json({ error: "Nombre requerido" });
    if (!unitType) return res.status(400).json({ error: "Unidad inválida" });

    if (productIds) {
      const products = await validateProducts(productIds, unitType);
      validatePricingGroupMembers({
        products,
        requestedProductIds: productIds,
        unitType,
        currentGroupId: groupId,
      });
    } else if (unitType !== existing.unitType) {
      const incompatibleMember = await prisma.product.findFirst({
        where: { pricingGroupId: groupId, unitType: { not: unitType } },
        select: { name: true },
      });
      if (incompatibleMember) {
        return res.status(400).json({
          error: `El producto "${incompatibleMember.name}" no usa la unidad ${unitType}`,
        });
      }
    }

    const group = await prisma.$transaction(async (tx) => {
      await tx.pricingGroup.update({
        where: { id: groupId },
        data: {
          name,
          unitType,
          ...(req.body?.isActive !== undefined ? { isActive } : {}),
        },
      });

      if (productIds) {
        await tx.product.updateMany({
          where: { pricingGroupId: groupId, id: { notIn: productIds } },
          data: { pricingGroupId: null },
        });
        if (productIds.length > 0) {
          const assigned = await tx.product.updateMany({
            where: {
              id: { in: productIds },
              unitType,
              isCustomProductTemplate: false,
              OR: [{ pricingGroupId: null }, { pricingGroupId: groupId }],
            },
            data: { pricingGroupId: groupId },
          });
          if (assigned.count !== productIds.length) {
            throw new Error("Uno o más productos ya pertenecen a otro grupo");
          }
        }
      }

      return tx.pricingGroup.findUnique({ where: { id: groupId }, include: groupInclude });
    });

    res.json({ group });
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Error actualizando grupo" });
  }
}

export async function deletePricingGroup(req: AuthedRequest, res: Response) {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "ID inválido" });

  try {
    const result = await hardDeleteUnusedPricingGroup(prisma, groupId);
    return res.json({ action: "deleted", ...result });
  } catch (error: unknown) {
    if (error instanceof PricingGroupNotFoundError) {
      return res.status(404).json({ code: error.code, error: error.message });
    }
    if (error instanceof PricingGroupHasHistoryError) {
      return res.status(409).json({
        code: error.code,
        error: error.message,
        appliedOrderItems: error.appliedOrderItems,
      });
    }
    return res.status(500).json({ error: "Error eliminando grupo" });
  }
}

export async function archivePricingGroup(req: AuthedRequest, res: Response) {
  const groupId = parseGroupId(req.params.id);
  if (!groupId) return res.status(400).json({ error: "ID inválido" });

  try {
    const result = await archivePricingGroupTransaction(prisma, groupId);
    return res.json({ action: "archived", ...result });
  } catch (error: unknown) {
    if (error instanceof PricingGroupNotFoundError) {
      return res.status(404).json({ code: error.code, error: error.message });
    }
    return res.status(500).json({ error: "Error archivando grupo" });
  }
}
