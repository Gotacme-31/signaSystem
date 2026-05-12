-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "customProductName" TEXT,
ADD COLUMN     "customUnitPrice" DECIMAL(12,2),
ADD COLUMN     "customUnitType" "UnitType",
ADD COLUMN     "isCustomProduct" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isCustomProductTemplate" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "Product" (
  "name",
  "unitType",
  "needsVariant",
  "isActive",
  "minQty",
  "qtyStep",
  "isCustomProductTemplate"
)
VALUES (
  '__PRODUCTO_LIBRE__',
  'PIECE',
  false,
  false,
  1,
  1,
  true
)
ON CONFLICT ("name")
DO UPDATE SET
  "isCustomProductTemplate" = true,
  "isActive" = false;
  
-- CreateIndex
CREATE INDEX "OrderItem_isCustomProduct_idx" ON "OrderItem"("isCustomProduct");

-- CreateIndex
CREATE INDEX "Product_isCustomProductTemplate_idx" ON "Product"("isCustomProductTemplate");
