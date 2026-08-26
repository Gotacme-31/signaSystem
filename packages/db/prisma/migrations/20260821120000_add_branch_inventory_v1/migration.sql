-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM (
  'INITIAL_STOCK',
  'RESTOCK',
  'MANUAL_REMOVE',
  'ADJUSTMENT',
  'ORDER_CREATED',
  'ORDER_EDITED',
  'ORDER_CANCELLED'
);

-- CreateEnum
CREATE TYPE "InventoryTrackingMode" AS ENUM ('PRODUCT', 'VARIANT');

-- AlterTable
ALTER TABLE "Order"
ADD COLUMN "clientRequestId" TEXT,
ADD COLUMN "requestHash" TEXT,
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "inventoryReturnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderItem"
ADD COLUMN "inventoryBalanceId" INTEGER,
ADD COLUMN "inventoryDeductedQty" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BranchInventoryConfig" (
  "id" SERIAL NOT NULL,
  "branchProductId" INTEGER NOT NULL,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "trackingMode" "InventoryTrackingMode" NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "activatedById" INTEGER,
  "deactivatedAt" TIMESTAMP(3),
  "deactivatedById" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BranchInventoryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchInventoryBalance" (
  "id" SERIAL NOT NULL,
  "inventoryConfigId" INTEGER NOT NULL,
  "variantId" INTEGER,
  "currentStock" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BranchInventoryBalance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BranchInventoryBalance_currentStock_check" CHECK ("currentStock" >= 0),
  CONSTRAINT "BranchInventoryBalance_lowStockThreshold_check" CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0),
  CONSTRAINT "BranchInventoryBalance_version_check" CHECK ("version" >= 0)
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
  "id" SERIAL NOT NULL,
  "inventoryBalanceId" INTEGER NOT NULL,
  "deltaQty" INTEGER NOT NULL,
  "stockBefore" INTEGER NOT NULL,
  "stockAfter" INTEGER NOT NULL,
  "movementType" "InventoryMovementType" NOT NULL,
  "orderId" INTEGER,
  "orderItemId" INTEGER,
  "createdById" INTEGER,
  "reason" TEXT,
  "operationKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InventoryMovement_stockBefore_check" CHECK ("stockBefore" >= 0),
  CONSTRAINT "InventoryMovement_stockAfter_check" CHECK ("stockAfter" >= 0),
  CONSTRAINT "InventoryMovement_stock_consistency_check" CHECK ("stockAfter" = "stockBefore" + "deltaQty")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");
CREATE UNIQUE INDEX "BranchInventoryConfig_branchProductId_key" ON "BranchInventoryConfig"("branchProductId");
CREATE INDEX "BranchInventoryConfig_isEnabled_idx" ON "BranchInventoryConfig"("isEnabled");
CREATE INDEX "BranchInventoryConfig_activatedById_idx" ON "BranchInventoryConfig"("activatedById");
CREATE INDEX "BranchInventoryConfig_deactivatedById_idx" ON "BranchInventoryConfig"("deactivatedById");
CREATE UNIQUE INDEX "BranchInventoryBalance_product_key"
ON "BranchInventoryBalance"("inventoryConfigId")
WHERE "variantId" IS NULL;
CREATE UNIQUE INDEX "BranchInventoryBalance_variant_key"
ON "BranchInventoryBalance"("inventoryConfigId", "variantId")
WHERE "variantId" IS NOT NULL;
CREATE INDEX "BranchInventoryBalance_inventoryConfigId_idx" ON "BranchInventoryBalance"("inventoryConfigId");
CREATE INDEX "BranchInventoryBalance_variantId_idx" ON "BranchInventoryBalance"("variantId");
CREATE INDEX "BranchInventoryBalance_currentStock_idx" ON "BranchInventoryBalance"("currentStock");
CREATE UNIQUE INDEX "InventoryMovement_operationKey_key" ON "InventoryMovement"("operationKey");
CREATE INDEX "InventoryMovement_inventoryBalanceId_createdAt_idx" ON "InventoryMovement"("inventoryBalanceId", "createdAt");
CREATE INDEX "InventoryMovement_orderId_idx" ON "InventoryMovement"("orderId");
CREATE INDEX "InventoryMovement_orderItemId_idx" ON "InventoryMovement"("orderItemId");
CREATE INDEX "InventoryMovement_createdById_idx" ON "InventoryMovement"("createdById");
CREATE INDEX "InventoryMovement_movementType_idx" ON "InventoryMovement"("movementType");
CREATE INDEX "OrderItem_inventoryBalanceId_idx" ON "OrderItem"("inventoryBalanceId");

-- AddCheckConstraint
ALTER TABLE "OrderItem"
ADD CONSTRAINT "OrderItem_inventoryDeductedQty_check" CHECK ("inventoryDeductedQty" >= 0);

-- AddForeignKey
ALTER TABLE "BranchInventoryConfig" ADD CONSTRAINT "BranchInventoryConfig_branchProductId_fkey"
FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchInventoryConfig" ADD CONSTRAINT "BranchInventoryConfig_activatedById_fkey"
FOREIGN KEY ("activatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BranchInventoryConfig" ADD CONSTRAINT "BranchInventoryConfig_deactivatedById_fkey"
FOREIGN KEY ("deactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BranchInventoryBalance" ADD CONSTRAINT "BranchInventoryBalance_inventoryConfigId_fkey"
FOREIGN KEY ("inventoryConfigId") REFERENCES "BranchInventoryConfig"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BranchInventoryBalance" ADD CONSTRAINT "BranchInventoryBalance_variantId_fkey"
FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_inventoryBalanceId_fkey"
FOREIGN KEY ("inventoryBalanceId") REFERENCES "BranchInventoryBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_orderItemId_fkey"
FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_inventoryBalanceId_fkey"
FOREIGN KEY ("inventoryBalanceId") REFERENCES "BranchInventoryBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
