import { InventoryError } from "./inventory.service";

export type ExistingVariant = {
  id: number;
  name: string;
  isActive: boolean;
  order: number;
};

export type RequestedVariant = {
  id: number | null;
  name: string;
  isActive: boolean;
  order: number;
};

export function planStableVariantChanges(
  existing: ExistingVariant[],
  requested: RequestedVariant[],
  hasInventory: boolean
) {
  const requestedIds = requested.flatMap((variant) => variant.id ? [variant.id] : []);
  if (new Set(requestedIds).size !== requestedIds.length) {
    throw new InventoryError("DUPLICATE_PRODUCT_VARIANT_ID", "No se puede enviar la misma variante más de una vez", 400);
  }
  const byId = new Map(existing.map((variant) => [variant.id, variant]));
  const byName = new Map<string, ExistingVariant[]>();
  for (const variant of existing) {
    const key = variant.name.trim().toLocaleUpperCase("es");
    byName.set(key, [...(byName.get(key) ?? []), variant]);
  }

  const explicitIds = new Set(requested.flatMap((variant) => variant.id ? [variant.id] : []));
  const exactLegacyMatches = new Set<number>();
  const unmatchedLegacyRows = requested.filter((variant) => {
    if (variant.id) return false;
    const matches = byName.get(variant.name.toLocaleUpperCase("es")) ?? [];
    if (matches.length === 1) {
      exactLegacyMatches.add(matches[0].id);
      return false;
    }
    return true;
  });
  const omittedActive = existing.filter(
    (variant) => variant.isActive && !explicitIds.has(variant.id) && !exactLegacyMatches.has(variant.id)
  );
  if (hasInventory && unmatchedLegacyRows.length > 0 && omittedActive.length > 0) {
    throw new InventoryError(
      "VARIANT_IDS_REQUIRED_FOR_INVENTORY_PRODUCT",
      "Envía los IDs de variantes existentes para renombrar tamaños con inventario.",
      409
    );
  }

  const retainedIds = new Set<number>();
  const updates: Array<{ id: number; name: string; isActive: boolean; order: number }> = [];
  const creates: Array<{ name: string; isActive: boolean; order: number }> = [];

  for (const variant of requested) {
    let existingVariant = variant.id ? byId.get(variant.id) : undefined;
    if (variant.id && !existingVariant) {
      throw new InventoryError("INVALID_PRODUCT_VARIANT", "La variante no pertenece al producto", 400);
    }
    if (!existingVariant) {
      const matches = byName.get(variant.name.toLocaleUpperCase("es")) ?? [];
      if (matches.length === 1) existingVariant = matches[0];
    }
    if (existingVariant) {
      retainedIds.add(existingVariant.id);
      updates.push({
        id: existingVariant.id,
        name: variant.name,
        isActive: variant.isActive,
        order: variant.order,
      });
    } else {
      creates.push({ name: variant.name, isActive: variant.isActive, order: variant.order });
    }
  }

  return {
    updates,
    creates,
    deactivateIds: existing.filter((variant) => !retainedIds.has(variant.id)).map((variant) => variant.id),
  };
}
