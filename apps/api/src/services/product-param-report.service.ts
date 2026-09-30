import { Prisma, ParamChargeType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { CANCELLATION_MARKER } from "./order-cancellation.service";
import { isValidDateKey, nextBusinessDayStartUtc, startOfBusinessDayUtc } from "../lib/business-time";

export class ProductParamReportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "ProductParamReportError";
  }
}

export type ProductParamReportClient = {
  product: {
    findUnique: (args: {
      where: { id: number };
      select: { id: true; name: true; unitType: true };
    }) => Promise<{ id: number; name: string; unitType: "METER" | "PIECE" } | null>;
  };
  branch: {
    findMany: (args: {
      where: { id: { in: number[] } };
      select: { id: true; name: true };
    }) => Promise<Array<{ id: number; name: string }>>;
  };
  productParam: {
    findMany: (args: {
      where: { id: { in: number[] } };
      select: { id: true; productId: true; name: true; chargeType: true };
    }) => Promise<Array<{ id: number; productId: number; name: string; chargeType: "PER_METER" | "PER_PIECE" }>>;
  };
  productVariant: {
    findMany: (args: {
      where: { id: { in: number[] } };
      select: { id: true; productId: true; name: true };
    }) => Promise<Array<{ id: number; productId: number; name: string }>>;
  };
  orderItem: {
    aggregate: (args: {
      where: Prisma.OrderItemWhereInput;
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: Prisma.Decimal | null } }>;
  };
  orderItemOption: {
    aggregate: (args: {
      where: Prisma.OrderItemOptionWhereInput;
      _sum: { quantity: true };
    }) => Promise<{ _sum: { quantity: Prisma.Decimal | null } }>;
  };
};

export type ProductParamReportArgs = {
  productId: number;
  branchIds?: number[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  paramIds?: number[];
  variantIds?: number[];
};

export type ProductParamReportResult = {
  productId: number;
  productName: string;
  unitType: "METER" | "PIECE";
  branchLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  totalQuantity: number;
  byParam: Array<{
    paramId: number;
    paramName: string;
    chargeType: "PER_METER" | "PER_PIECE";
    quantity: number;
  }>;
  byVariant: Array<{
    variantId: number;
    variantName: string;
    quantity: number;
  }>;
};

function decimalToNumber(value: Prisma.Decimal | null | undefined): number {
  return value ? value.toNumber() : 0;
}

export async function getProductParamReport(
  args: ProductParamReportArgs,
  client: ProductParamReportClient = prisma
): Promise<ProductParamReportResult> {
  const { productId, branchIds, dateFrom, dateTo, paramIds = [], variantIds = [] } = args;

  if (!Number.isInteger(productId) || productId <= 0) {
    throw new ProductParamReportError("productId inválido", 400, "INVALID_PRODUCT_ID");
  }

  if (dateFrom && !isValidDateKey(dateFrom)) {
    throw new ProductParamReportError("dateFrom inválido", 400, "INVALID_DATE_FROM");
  }
  if (dateTo && !isValidDateKey(dateTo)) {
    throw new ProductParamReportError("dateTo inválido", 400, "INVALID_DATE_TO");
  }

  const product = await client.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, unitType: true },
  });
  if (!product) {
    throw new ProductParamReportError("Producto no encontrado", 404, "PRODUCT_NOT_FOUND");
  }

  const uniqueBranchIds = Array.from(new Set(branchIds ?? []));
  let branchLabel = "Todas las sucursales";
  if (uniqueBranchIds.length > 0) {
    const branches = await client.branch.findMany({
      where: { id: { in: uniqueBranchIds } },
      select: { id: true, name: true },
    });

    if (branches.length !== uniqueBranchIds.length) {
      throw new ProductParamReportError("Una o más sucursales no existen", 404, "BRANCH_NOT_FOUND");
    }

    branchLabel = branches.length === 1 ? branches[0].name : `${branches.length} sucursales`;
  }

  const uniqueParamIds = Array.from(new Set(paramIds));
  let params: Array<{ id: number; productId: number; name: string; chargeType: "PER_METER" | "PER_PIECE" }> = [];
  if (uniqueParamIds.length > 0) {
    params = await client.productParam.findMany({
      where: { id: { in: uniqueParamIds } },
      select: { id: true, productId: true, name: true, chargeType: true },
    });

    if (params.length !== uniqueParamIds.length) {
      throw new ProductParamReportError(
        "Uno o más parámetros no existen",
        400,
        "PARAM_NOT_FOUND"
      );
    }

    const belongsToOtherProduct = params.find((param) => param.productId !== productId);
    if (belongsToOtherProduct) {
      throw new ProductParamReportError(
        `El parámetro "${belongsToOtherProduct.name}" no pertenece al producto seleccionado`,
        400,
        "PARAM_PRODUCT_MISMATCH"
      );
    }
  }

  const uniqueVariantIds = Array.from(new Set(variantIds));
  let variants: Array<{ id: number; productId: number; name: string }> = [];
  if (uniqueVariantIds.length > 0) {
    variants = await client.productVariant.findMany({
      where: { id: { in: uniqueVariantIds } },
      select: { id: true, productId: true, name: true },
    });

    if (variants.length !== uniqueVariantIds.length) {
      throw new ProductParamReportError(
        "Uno o más tamaños no existen",
        400,
        "VARIANT_NOT_FOUND"
      );
    }

    const belongsToOtherProduct = variants.find((variant) => variant.productId !== productId);
    if (belongsToOtherProduct) {
      throw new ProductParamReportError(
        `El tamaño "${belongsToOtherProduct.name}" no pertenece al producto seleccionado`,
        400,
        "VARIANT_PRODUCT_MISMATCH"
      );
    }
  }

  const orderWhere: Prisma.OrderWhereInput = {
    OR: [{ notes: null }, { notes: { not: { contains: CANCELLATION_MARKER } } }],
    ...(dateFrom || dateTo
      ? {
          createdAt: {
            ...(dateFrom ? { gte: startOfBusinessDayUtc(dateFrom) } : {}),
            ...(dateTo ? { lt: nextBusinessDayStartUtc(dateTo) } : {}),
          },
        }
      : {}),
    ...(uniqueBranchIds.length > 0 ? { branchId: { in: uniqueBranchIds } } : {}),
  };

  const baseItemWhere: Prisma.OrderItemWhereInput = {
    productId,
    isCustomProduct: false,
    order: orderWhere,
  };

  const totalAgg = await client.orderItem.aggregate({
    where: baseItemWhere,
    _sum: { quantity: true },
  });

  const byParam: ProductParamReportResult["byParam"] = [];
  for (const param of params) {
    if (param.chargeType === ParamChargeType.PER_PIECE) {
      // OrderItemOption.quantity holds the piece count for PER_PIECE params.
      const agg = await client.orderItemOption.aggregate({
        where: {
          optionId: param.id,
          orderItem: baseItemWhere,
        },
        _sum: { quantity: true },
      });
      byParam.push({
        paramId: param.id,
        paramName: param.name,
        chargeType: param.chargeType,
        quantity: decimalToNumber(agg._sum.quantity),
      });
    } else {
      // PER_METER: OrderItemOption.quantity is always 1, never meters.
      // The real quantity lives on the OrderItem that carries this option.
      const agg = await client.orderItem.aggregate({
        where: {
          ...baseItemWhere,
          options: { some: { optionId: param.id } },
        },
        _sum: { quantity: true },
      });
      byParam.push({
        paramId: param.id,
        paramName: param.name,
        chargeType: param.chargeType,
        quantity: decimalToNumber(agg._sum.quantity),
      });
    }
  }

  const byVariant: ProductParamReportResult["byVariant"] = [];
  for (const variant of variants) {
    const agg = await client.orderItem.aggregate({
      where: {
        ...baseItemWhere,
        variantId: variant.id,
      },
      _sum: { quantity: true },
    });
    byVariant.push({
      variantId: variant.id,
      variantName: variant.name,
      quantity: decimalToNumber(agg._sum.quantity),
    });
  }

  byParam.sort((a, b) => b.quantity - a.quantity);
  byVariant.sort((a, b) => b.quantity - a.quantity);

  return {
    productId: product.id,
    productName: product.name,
    unitType: product.unitType,
    branchLabel,
    dateFrom: dateFrom ?? null,
    dateTo: dateTo ?? null,
    totalQuantity: decimalToNumber(totalAgg._sum.quantity),
    byParam,
    byVariant,
  };
}
