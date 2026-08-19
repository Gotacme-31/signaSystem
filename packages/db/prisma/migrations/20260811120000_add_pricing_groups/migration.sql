CREATE TABLE "PricingGroup" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "unitType" "UnitType" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PricingGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PricingGroup_name_key" ON "PricingGroup"("name");

ALTER TABLE "Product" ADD COLUMN "pricingGroupId" INTEGER;

ALTER TABLE "OrderItem"
  ADD COLUMN "appliedPricingGroupId" INTEGER,
  ADD COLUMN "appliedGroupQuantity" DECIMAL(12,3);

CREATE INDEX "Product_pricingGroupId_idx" ON "Product"("pricingGroupId");
CREATE INDEX "OrderItem_appliedPricingGroupId_idx" ON "OrderItem"("appliedPricingGroupId");

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_pricingGroupId_fkey"
  FOREIGN KEY ("pricingGroupId") REFERENCES "PricingGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_appliedPricingGroupId_fkey"
  FOREIGN KEY ("appliedPricingGroupId") REFERENCES "PricingGroup"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_appliedGroupQuantity_check"
  CHECK ("appliedGroupQuantity" IS NULL OR "appliedGroupQuantity" > 0);
