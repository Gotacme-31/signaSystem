-- CreateEnum
CREATE TYPE "PriceTier" AS ENUM ('RETAIL', 'WHOLESALE', 'BULK');

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "tierSnapshot" "PriceTier",
ADD COLUMN     "variantId" INTEGER;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "halfStepSpecialPrice" DECIMAL(12,2),
ADD COLUMN     "minQty" DECIMAL(12,3) NOT NULL DEFAULT 1,
ADD COLUMN     "qtyStep" DECIMAL(12,3) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "BranchProductTierPrice" (
    "id" SERIAL NOT NULL,
    "branchProductId" INTEGER NOT NULL,
    "tier" "PriceTier" NOT NULL,
    "minQty" DECIMAL(12,3) NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchProductTierPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchProductVariantPrice" (
    "id" SERIAL NOT NULL,
    "branchProductId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchProductVariantPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOptionGroup" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "minPick" INTEGER NOT NULL DEFAULT 0,
    "maxPick" INTEGER,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOptionGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductOption" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProductOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItemOption" (
    "id" SERIAL NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItemOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchProductTierPrice_branchProductId_idx" ON "BranchProductTierPrice"("branchProductId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProductTierPrice_branchProductId_tier_minQty_key" ON "BranchProductTierPrice"("branchProductId", "tier", "minQty");

-- CreateIndex
CREATE INDEX "BranchProductVariantPrice_branchProductId_idx" ON "BranchProductVariantPrice"("branchProductId");

-- CreateIndex
CREATE INDEX "BranchProductVariantPrice_variantId_idx" ON "BranchProductVariantPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProductVariantPrice_branchProductId_variantId_key" ON "BranchProductVariantPrice"("branchProductId", "variantId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_name_key" ON "ProductVariant"("productId", "name");

-- CreateIndex
CREATE INDEX "ProductOptionGroup_productId_idx" ON "ProductOptionGroup"("productId");

-- CreateIndex
CREATE INDEX "ProductOption_groupId_idx" ON "ProductOption"("groupId");

-- CreateIndex
CREATE INDEX "OrderItemOption_orderItemId_idx" ON "OrderItemOption"("orderItemId");

-- CreateIndex
CREATE INDEX "OrderItemOption_optionId_idx" ON "OrderItemOption"("optionId");

-- CreateIndex
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- AddForeignKey
ALTER TABLE "BranchProductTierPrice" ADD CONSTRAINT "BranchProductTierPrice_branchProductId_fkey" FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProductVariantPrice" ADD CONSTRAINT "BranchProductVariantPrice_branchProductId_fkey" FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProductVariantPrice" ADD CONSTRAINT "BranchProductVariantPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOptionGroup" ADD CONSTRAINT "ProductOptionGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductOption" ADD CONSTRAINT "ProductOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ProductOptionGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemOption" ADD CONSTRAINT "OrderItemOption_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
