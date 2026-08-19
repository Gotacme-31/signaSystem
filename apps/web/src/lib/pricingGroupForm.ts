import type {
  PricingGroupProductOption,
  PricingGroupUnit,
} from "../api/pricingGroups";

export function uniqueProductIds(productIds: number[]) {
  return [...new Set(productIds)];
}

export function toggleProductId(productIds: number[], productId: number) {
  return productIds.includes(productId)
    ? productIds.filter((id) => id !== productId)
    : uniqueProductIds([...productIds, productId]);
}

export function isProductOccupied(
  product: PricingGroupProductOption,
  currentGroupId: number | null
) {
  return product.pricingGroupId !== null && product.pricingGroupId !== currentGroupId;
}

export function filterPricingGroupProducts(
  products: PricingGroupProductOption[],
  unitType: PricingGroupUnit,
  query: string
) {
  const normalizedQuery = query.trim().toLocaleLowerCase("es");
  return products.filter((product) => {
    if (product.unitType !== unitType) return false;
    if (!normalizedQuery) return true;
    return product.name.toLocaleLowerCase("es").includes(normalizedQuery)
      || String(product.id).includes(normalizedQuery);
  });
}

export function incompatibleProductIds(
  productIds: number[],
  products: PricingGroupProductOption[],
  nextUnitType: PricingGroupUnit
) {
  const productsById = new Map(products.map((product) => [product.id, product]));
  return productIds.filter((id) => productsById.get(id)?.unitType !== nextUnitType);
}
