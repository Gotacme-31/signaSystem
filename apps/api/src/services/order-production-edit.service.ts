import { Prisma } from "@prisma/client";

export function physicalScheduleChanged(args: {
  deliveryWasChanged: boolean;
  existingItems: Array<{
    id: number;
    productId: number;
    quantity: Prisma.Decimal | number | string;
    isCustomProduct?: boolean;
  }>;
  itemUpdates?: Array<Record<string, unknown>>;
}) {
  if (args.deliveryWasChanged) return true;
  const existingById = new Map(args.existingItems.map((item) => [item.id, item]));

  return (args.itemUpdates ?? []).some((update) => {
    const existing = existingById.get(Number(update.id));
    if (!existing) return false;
    if (existing.isCustomProduct) return false;
    if (
      Object.prototype.hasOwnProperty.call(update, "productId")
      && Number(update.productId) !== existing.productId
    ) return true;
    if (!Object.prototype.hasOwnProperty.call(update, "quantity")) return false;
    try {
      return !new Prisma.Decimal(String(update.quantity)).equals(existing.quantity);
    } catch {
      return true;
    }
  });
}
