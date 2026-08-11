type TemplateAwareBranchProduct = {
  productId: number;
  isActive: boolean;
  product?: {
    id: number;
    isCustomProductTemplate?: boolean;
  } | null;
};

export function splitOrderBranchProducts<T extends TemplateAwareBranchProduct>(
  rows: readonly T[]
) {
  const templateRows = rows.filter(
    (row) => row.product?.isCustomProductTemplate === true
  );
  const templateRow = templateRows.length === 1 ? templateRows[0] : null;

  return {
    normalCatalogRows: rows.filter(
      (row) =>
        row.isActive &&
        !!row.product?.id &&
        row.product.isCustomProductTemplate !== true
    ),
    customProductAllowed: templateRow?.isActive === true,
    customProductTemplateId: templateRow?.productId ?? null,
  };
}

type CustomProductDraft = {
  quantity: number;
  customProductName?: string;
  customUnitType?: "METER" | "PIECE";
  customUnitPrice?: number;
};

export function buildCustomProductRequest(
  item: CustomProductDraft,
  templateId: number
) {
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("Template de Producto Libre no disponible");
  }

  return {
    productId: templateId,
    quantity: item.quantity.toString(),
    variantId: null,
    selectedParams: [],
    isCustomProduct: true as const,
    customProductName: item.customProductName ?? "",
    customUnitType: item.customUnitType ?? "PIECE",
    customUnitPrice: item.customUnitPrice ?? 0,
  };
}
