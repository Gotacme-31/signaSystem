import type { Request, Response } from "express";
import { getProductParamReport, ProductParamReportError } from "../services/product-param-report.service";

function parseId(value: unknown): number | null {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : null;
}

function parseIdList(value: unknown): number[] {
  if (value === undefined || value === null || value === "") return [];
  if (typeof value !== "string") return [];

  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((id) => Number.isInteger(id) && id > 0);
}

export async function getProductParamReportController(req: Request, res: Response) {
  try {
    const productId = parseId(req.query.productId);
    if (!productId) {
      return res.status(400).json({ error: "productId inválido" });
    }

    const branchIds = parseIdList(req.query.branchId ?? req.query.branchIds);
    const dateFrom = typeof req.query.dateFrom === "string" ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === "string" ? req.query.dateTo : undefined;
    const paramIds = parseIdList(req.query.paramIds);
    const variantIds = parseIdList(req.query.variantIds);

    const report = await getProductParamReport({
      productId,
      branchIds,
      dateFrom,
      dateTo,
      paramIds,
      variantIds,
    });

    return res.json(report);
  } catch (error) {
    if (error instanceof ProductParamReportError) {
      return res.status(error.status).json({ error: error.message, code: error.code });
    }
    console.error("Error generando reporte de producto y parámetro:", error);
    return res.status(500).json({ error: "Error generando el reporte" });
  }
}
