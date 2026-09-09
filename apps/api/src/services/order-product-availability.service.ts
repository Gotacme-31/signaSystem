export type NewOrderProductAvailability = {
  isActive: boolean;
  product: {
    isActive: boolean;
    isCustomProductTemplate: boolean;
    name?: string;
  };
};

export class OrderProductUnavailableError extends Error {
  readonly code = "PRODUCT_NOT_AVAILABLE";
  readonly status = 409;
  readonly details: { productId: number };

  constructor(productId: number, productName?: string) {
    super(`Producto "${productName || productId}" no disponible en esta sucursal`);
    this.name = "OrderProductUnavailableError";
    this.details = { productId };
  }
}

export function isProductAvailableForNewOrder(
  branchProduct: NewOrderProductAvailability | null | undefined
) {
  if (!branchProduct?.isActive) return false;
  if (branchProduct.product.isCustomProductTemplate) return true;
  return branchProduct.product.isActive;
}

export function assertNormalProductAvailableForNewOrder(
  branchProduct: NewOrderProductAvailability | null | undefined,
  productId: number
) {
  if (
    !branchProduct ||
    branchProduct.product.isCustomProductTemplate ||
    !isProductAvailableForNewOrder(branchProduct)
  ) {
    throw new OrderProductUnavailableError(productId, branchProduct?.product.name);
  }
}
