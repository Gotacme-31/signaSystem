import { apiFetch } from "./http";

export type ProductParamReportByParam = {
  paramId: number;
  paramName: string;
  chargeType: "PER_METER" | "PER_PIECE";
  quantity: number;
};

export type ProductParamReportByVariant = {
  variantId: number;
  variantName: string;
  quantity: number;
};

export type ProductParamReport = {
  productId: number;
  productName: string;
  unitType: "METER" | "PIECE";
  branchLabel: string;
  dateFrom: string | null;
  dateTo: string | null;
  totalQuantity: number;
  byParam: ProductParamReportByParam[];
  byVariant: ProductParamReportByVariant[];
};

export type ProductParamReportQuery = {
  productId: number;
  branchIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  paramIds?: number[];
  variantIds?: number[];
};

export async function getProductParamReport(query: ProductParamReportQuery): Promise<ProductParamReport> {
  const params = new URLSearchParams();
  params.set("productId", String(query.productId));
  if (query.branchIds && query.branchIds.length > 0) params.set("branchIds", query.branchIds.join(","));
  if (query.dateFrom) params.set("dateFrom", query.dateFrom);
  if (query.dateTo) params.set("dateTo", query.dateTo);
  if (query.paramIds && query.paramIds.length > 0) params.set("paramIds", query.paramIds.join(","));
  if (query.variantIds && query.variantIds.length > 0) params.set("variantIds", query.variantIds.join(","));

  return apiFetch(`/admin/reports/product-params?${params.toString()}`);
}
