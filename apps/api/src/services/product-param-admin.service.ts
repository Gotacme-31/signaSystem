export type ExistingProductParam = {
  id: number;
  name: string;
  isActive: boolean;
  order: number;
  chargeType: "PER_METER" | "PER_PIECE";
};

export type RequestedProductParam = {
  id?: number | null;
  name: string;
  isActive: boolean;
  order: number;
  chargeType: "PER_METER" | "PER_PIECE";
};

export class ProductParamAdminError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "ProductParamAdminError";
  }
}

function normalizedName(value: string) {
  return value.trim().toLocaleUpperCase("es");
}

export function planStableProductParamChanges(
  existing: ExistingProductParam[],
  requested: RequestedProductParam[]
) {
  for (const param of requested) {
    if (
      param.id !== undefined
      && param.id !== null
      && (!Number.isSafeInteger(param.id) || param.id <= 0)
    ) {
      throw new ProductParamAdminError("INVALID_PRODUCT_PARAM", "El ID del parámetro no es válido");
    }
  }
  const requestedIds = requested.flatMap((param) =>
    typeof param.id === "number" ? [param.id] : []
  );
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new ProductParamAdminError(
      "DUPLICATE_PRODUCT_PARAM_ID",
      "No se puede enviar el mismo parámetro más de una vez"
    );
  }

  const byId = new Map(existing.map((param) => [param.id, param]));
  const byName = new Map<string, ExistingProductParam[]>();
  for (const param of existing) {
    const key = normalizedName(param.name);
    byName.set(key, [...(byName.get(key) ?? []), param]);
  }

  for (const param of requested) {
    if (typeof param.id === "number" && !byId.has(param.id)) {
      throw new ProductParamAdminError(
        "INVALID_PRODUCT_PARAM",
        "El parámetro no pertenece al producto"
      );
    }
  }

  const claimedIds = new Set(requestedIds);
  const nameMatches = new Map<RequestedProductParam, ExistingProductParam>();
  const unmatchedLegacyRows: RequestedProductParam[] = [];

  for (const param of requested) {
    if (typeof param.id === "number") continue;
    const matches = (byName.get(normalizedName(param.name)) ?? [])
      .filter((match) => !claimedIds.has(match.id));
    if (matches.length === 1) {
      nameMatches.set(param, matches[0]);
      claimedIds.add(matches[0].id);
    } else if (matches.length > 1) {
      throw new ProductParamAdminError(
        "AMBIGUOUS_LEGACY_PRODUCT_PARAM",
        `No se pudo identificar inequívocamente el parámetro "${param.name}"`
      );
    } else if (param.id === undefined) {
      unmatchedLegacyRows.push(param);
    }
  }

  const omittedExisting = existing.filter((param) => !claimedIds.has(param.id));
  if (unmatchedLegacyRows.length > 0 && omittedExisting.length > 0) {
    throw new ProductParamAdminError(
      "AMBIGUOUS_LEGACY_PRODUCT_PARAM",
      "El payload sin IDs no permite distinguir parámetros nuevos de parámetros renombrados"
    );
  }
  const omittedByName = new Map(
    omittedExisting.map((param) => [normalizedName(param.name), param])
  );
  for (const param of requested) {
    const conflict = omittedByName.get(normalizedName(param.name));
    if (conflict) {
      throw new ProductParamAdminError(
        "PRODUCT_PARAM_NAME_CONFLICT",
        `El nombre "${param.name}" pertenece al parámetro ${conflict.id}; reactiva esa fila`
      );
    }
  }

  const retainedIds = new Set<number>();
  const updates: Array<{
    id: number;
    name: string;
    isActive: boolean;
    order: number;
    chargeType: "PER_METER" | "PER_PIECE";
  }> = [];
  const creates: Array<{
    name: string;
    isActive: boolean;
    order: number;
    chargeType: "PER_METER" | "PER_PIECE";
  }> = [];

  for (const param of requested) {
    const existingParam = typeof param.id === "number" ? byId.get(param.id) : nameMatches.get(param);
    if (existingParam) {
      retainedIds.add(existingParam.id);
      updates.push({
        id: existingParam.id,
        name: param.name,
        isActive: param.isActive,
        order: param.order,
        chargeType: param.chargeType,
      });
    } else {
      creates.push({
        name: param.name,
        isActive: param.isActive,
        order: param.order,
        chargeType: param.chargeType,
      });
    }
  }

  return {
    updates,
    creates,
    deactivateIds: existing.filter((param) => !retainedIds.has(param.id)).map((param) => param.id),
  };
}
