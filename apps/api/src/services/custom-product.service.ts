import type { Prisma } from "@prisma/client";

type CustomProductDb = Pick<Prisma.TransactionClient, "product" | "branchProduct">;

export const LEGACY_CUSTOM_PRODUCT_ID = -1;

export type CanonicalCustomProductTemplate = {
  id: number;
};

export async function resolveCanonicalCustomProductTemplate(
  db: CustomProductDb
): Promise<CanonicalCustomProductTemplate> {
  const templates = await db.product.findMany({
    where: { isCustomProductTemplate: true },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 2,
  });

  if (templates.length === 0) {
    throw new Error("No existe una configuración válida de Producto Libre.");
  }

  if (templates.length > 1) {
    throw new Error("Existe más de un template configurado para Producto Libre.");
  }

  return templates[0];
}

export async function resolveEnabledCustomProductTemplate(
  db: CustomProductDb,
  branchId: number
): Promise<CanonicalCustomProductTemplate> {
  const template = await resolveCanonicalCustomProductTemplate(db);
  const branchProduct = await db.branchProduct.findUnique({
    where: {
      branchId_productId: {
        branchId,
        productId: template.id,
      },
    },
    select: { isActive: true },
  });

  if (branchProduct?.isActive !== true) {
    throw new Error("Producto Libre no está habilitado para esta sucursal.");
  }

  return template;
}

export function resolveCustomProductIdForPersistence(
  productId: number,
  templateId: number
): number {
  // Compatibilidad temporal con clientes desplegados que todavía envían -1.
  if (productId !== LEGACY_CUSTOM_PRODUCT_ID && productId !== templateId) {
    throw new Error("El productId no corresponde al template de Producto Libre.");
  }

  return templateId;
}

export function assertTemplateIsNotNormalProduct(productId: number, templateId: number) {
  if (productId === templateId) {
    throw new Error("El template de Producto Libre no puede registrarse como producto normal.");
  }
}

export function assertCustomUnitType(value: unknown): asserts value is "METER" | "PIECE" {
  if (value !== "METER" && value !== "PIECE") {
    throw new Error("El tipo de unidad de Producto Libre debe ser METER o PIECE.");
  }
}

type ExistingOrderItemKind = {
  isCustomProduct: boolean;
  productId?: unknown;
  quantity?: unknown;
  customProductName?: unknown;
  customUnitType?: unknown;
  customUnitPrice?: unknown;
};

type OrderItemUpdateKind = {
  isCustomProduct?: unknown;
  productId?: unknown;
  quantity?: unknown;
  customProductName?: unknown;
  customUnitType?: unknown;
  customUnitPrice?: unknown;
};

const CUSTOM_COMMERCIAL_FIELDS = [
  "productId",
  "quantity",
  "customProductName",
  "customUnitType",
  "customUnitPrice",
] as const;

function decimalValuesEqual(left: unknown, right: unknown) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  return Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
    ? leftNumber === rightNumber
    : left === right;
}

function commercialFieldChanged(
  field: typeof CUSTOM_COMMERCIAL_FIELDS[number],
  existingItem: ExistingOrderItemKind,
  itemUpdate: OrderItemUpdateKind
) {
  if (!Object.prototype.hasOwnProperty.call(itemUpdate, field)) return false;

  if (
    field === "productId" &&
    existingItem.isCustomProduct &&
    Number(itemUpdate.productId) === LEGACY_CUSTOM_PRODUCT_ID
  ) {
    return false;
  }

  if (field === "productId" || field === "quantity" || field === "customUnitPrice") {
    return !decimalValuesEqual(existingItem[field], itemUpdate[field]);
  }

  return existingItem[field] !== itemUpdate[field];
}

export function customProductUpdateRequiresAvailability(
  existingItem: ExistingOrderItemKind,
  itemUpdate: OrderItemUpdateKind
) {
  if (
    Object.prototype.hasOwnProperty.call(itemUpdate, "isCustomProduct") &&
    itemUpdate.isCustomProduct !== existingItem.isCustomProduct
  ) {
    throw new Error("No se permite convertir items normales en Producto Libre ni viceversa.");
  }

  if (!existingItem.isCustomProduct) return false;

  return CUSTOM_COMMERCIAL_FIELDS.some((field) =>
    commercialFieldChanged(field, existingItem, itemUpdate)
  );
}
