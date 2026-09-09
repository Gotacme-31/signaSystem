import { Prisma } from "@prisma/client";

export const MAX_PARAMETER_EXTRA_TIME_MINUTES = 2_147_483_647;

export class ParameterReadyTimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ParameterReadyTimeError";
  }
}

export type ParameterSelectionInput = {
  paramId: number;
  pieceQty?: number | string | null;
};

export type BranchParameterTimeConfiguration = {
  paramId: number;
  isActive: boolean;
  productionTimeMinutesPerUnit: number | null;
  param: {
    id: number;
    productId: number;
    name: string;
    isActive: boolean;
    chargeType: "PER_METER" | "PER_PIECE";
  };
};

export type ExistingParameterTimeSnapshot = {
  optionId: number;
  name: string;
  quantity: Prisma.Decimal | number | string;
  chargeType: "PER_METER" | "PER_PIECE";
  appliedTimeMinutesPerUnit: number;
  appliedExtraTimeMinutes: number;
};

export type ResolvedParameterTimeSnapshot = {
  paramId: number;
  name: string;
  chargeType: "PER_METER" | "PER_PIECE";
  pieceQty: number;
  appliedTimeMinutesPerUnit: number;
  appliedExtraTimeMinutes: number;
  retainedSnapshot: boolean;
};

function positiveItemQuantity(value: Prisma.Decimal | number | string) {
  let quantity: Prisma.Decimal;
  try {
    quantity = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(String(value));
  } catch {
    throw new ParameterReadyTimeError("INVALID_ITEM_QUANTITY", "quantity debe ser mayor a 0");
  }
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new ParameterReadyTimeError("INVALID_ITEM_QUANTITY", "quantity debe ser mayor a 0");
  }
  return quantity;
}

export function normalizeProductionTimeMinutesPerUnit(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const minutes = Number(value);
  if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > MAX_PARAMETER_EXTRA_TIME_MINUTES) {
    throw new ParameterReadyTimeError(
      "INVALID_PARAMETER_TIME",
      "El tiempo adicional debe ser un número entero no negativo"
    );
  }
  return minutes;
}

function positivePieceQuantity(value: unknown): number {
  const quantity = Number(value);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new ParameterReadyTimeError(
      "INVALID_PARAMETER_PIECE_QUANTITY",
      "pieceQty debe ser un entero mayor a 0"
    );
  }
  return quantity;
}

export function calculateParameterExtraTimeMinutes(args: {
  chargeType: "PER_METER" | "PER_PIECE";
  productionTimeMinutesPerUnit: unknown;
  itemQuantity: Prisma.Decimal | number | string;
  pieceQty?: unknown;
}) {
  const minutesPerUnit = normalizeProductionTimeMinutesPerUnit(args.productionTimeMinutesPerUnit);
  const multiplier = args.chargeType === "PER_PIECE"
    ? new Prisma.Decimal(positivePieceQuantity(args.pieceQty))
    : positiveItemQuantity(args.itemQuantity);
  const extra = new Prisma.Decimal(minutesPerUnit).mul(multiplier).ceil();

  if (!extra.isFinite() || extra.gt(MAX_PARAMETER_EXTRA_TIME_MINUTES)) {
    throw new ParameterReadyTimeError(
      "PARAMETER_TIME_OVERFLOW",
      "El tiempo adicional excede el máximo permitido"
    );
  }
  return extra.toNumber();
}

export function sumParameterExtraTimeMinutes(
  snapshots: ReadonlyArray<{ appliedExtraTimeMinutes: number }>
) {
  let total = 0;
  for (const snapshot of snapshots) {
    const minutes = normalizeProductionTimeMinutesPerUnit(snapshot.appliedExtraTimeMinutes);
    if (total > MAX_PARAMETER_EXTRA_TIME_MINUTES - minutes) {
      throw new ParameterReadyTimeError(
        "PARAMETER_TIME_OVERFLOW",
        "La suma del tiempo adicional excede el máximo permitido"
      );
    }
    total += minutes;
  }
  return total;
}

export function addElapsedMinutes(baseReadyAt: Date, extraMinutes: number) {
  const normalizedMinutes = normalizeProductionTimeMinutesPerUnit(extraMinutes);
  if (!(baseReadyAt instanceof Date) || Number.isNaN(baseReadyAt.getTime())) {
    throw new ParameterReadyTimeError("INVALID_BASE_READY_AT", "La fecha base de producción no es válida");
  }
  const result = new Date(baseReadyAt.getTime() + normalizedMinutes * 60_000);
  if (Number.isNaN(result.getTime())) {
    throw new ParameterReadyTimeError("PARAMETER_TIME_OVERFLOW", "La fecha efectiva excede el rango permitido");
  }
  return result;
}

export function resolveParameterTimeSnapshots(args: {
  productId: number;
  itemQuantity: Prisma.Decimal | number | string;
  selectedParams?: unknown;
  fallbackParamIds?: unknown;
  configurations: BranchParameterTimeConfiguration[];
  existingSnapshots?: ExistingParameterTimeSnapshot[];
}): ResolvedParameterTimeSnapshot[] {
  const itemQuantity = positiveItemQuantity(args.itemQuantity);
  if (args.selectedParams !== undefined && args.selectedParams !== null && !Array.isArray(args.selectedParams)) {
    throw new ParameterReadyTimeError(
      "INVALID_SELECTED_PARAMS",
      "selectedParams debe ser un arreglo"
    );
  }
  const selectedParams = Array.isArray(args.selectedParams)
    ? args.selectedParams as Array<Record<string, unknown>>
    : Array.isArray(args.fallbackParamIds)
      ? args.fallbackParamIds.map((paramId) => ({ paramId, pieceQty: 1 }))
      : [];
  const configurationByParamId = new Map(args.configurations.map((row) => [row.paramId, row]));
  const existingByParamId = new Map((args.existingSnapshots ?? []).map((row) => [row.optionId, row]));
  const seen = new Set<number>();

  const snapshots: ResolvedParameterTimeSnapshot[] = selectedParams.map((selection) => {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      throw new ParameterReadyTimeError(
        "INVALID_ORDER_ITEM_PARAM",
        "Cada parámetro seleccionado debe ser un objeto"
      );
    }
    const paramId = Number(selection.paramId);
    if (!Number.isSafeInteger(paramId) || paramId <= 0) {
      throw new ParameterReadyTimeError("INVALID_ORDER_ITEM_PARAM", "paramId inválido");
    }
    if (seen.has(paramId)) {
      throw new ParameterReadyTimeError(
        "DUPLICATE_ORDER_ITEM_PARAM",
        "No se puede seleccionar el mismo parámetro dos veces",
        400,
        { paramId }
      );
    }
    seen.add(paramId);

    const existing = existingByParamId.get(paramId);
    if (existing) {
      const chargeType = existing.chargeType === "PER_PIECE" ? "PER_PIECE" : "PER_METER";
      const pieceQty = chargeType === "PER_PIECE"
        ? positivePieceQuantity(selection.pieceQty ?? existing.quantity)
        : 1;
      const appliedTimeMinutesPerUnit = normalizeProductionTimeMinutesPerUnit(
        existing.appliedTimeMinutesPerUnit
      );
      return {
        paramId,
        name: existing.name,
        chargeType,
        pieceQty,
        appliedTimeMinutesPerUnit,
        appliedExtraTimeMinutes: calculateParameterExtraTimeMinutes({
          chargeType,
          productionTimeMinutesPerUnit: appliedTimeMinutesPerUnit,
          itemQuantity,
          pieceQty,
        }),
        retainedSnapshot: true,
      };
    }

    const configuration = configurationByParamId.get(paramId);
    if (!configuration || configuration.param.productId !== args.productId) {
      throw new ParameterReadyTimeError(
        "INVALID_ORDER_ITEM_PARAM",
        "El parámetro no existe o no pertenece al producto",
        400,
        { paramId, productId: args.productId }
      );
    }
    if (!configuration.param.isActive || !configuration.isActive) {
      throw new ParameterReadyTimeError(
        "INACTIVE_ORDER_ITEM_PARAM",
        "El parámetro no está activo y configurado para la sucursal",
        400,
        { paramId }
      );
    }

    const chargeType = configuration.param.chargeType === "PER_PIECE" ? "PER_PIECE" : "PER_METER";
    const pieceQty = chargeType === "PER_PIECE" ? positivePieceQuantity(selection.pieceQty) : 1;
    const appliedTimeMinutesPerUnit = normalizeProductionTimeMinutesPerUnit(
      configuration.productionTimeMinutesPerUnit
    );
    return {
      paramId,
      name: configuration.param.name,
      chargeType,
      pieceQty,
      appliedTimeMinutesPerUnit,
      appliedExtraTimeMinutes: calculateParameterExtraTimeMinutes({
        chargeType,
        productionTimeMinutesPerUnit: appliedTimeMinutesPerUnit,
        itemQuantity,
        pieceQty,
      }),
      retainedSnapshot: false,
    };
  });

  sumParameterExtraTimeMinutes(snapshots);
  return snapshots;
}
