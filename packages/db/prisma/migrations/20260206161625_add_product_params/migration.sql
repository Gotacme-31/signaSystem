-- CreateTable
CREATE TABLE "BranchProductVariantQuantityPrice" (
    "id" SERIAL NOT NULL,
    "branchProductId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "minQty" DECIMAL(12,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BranchProductVariantQuantityPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchProductVariantQuantityPrice_branchProductId_idx" ON "BranchProductVariantQuantityPrice"("branchProductId");

-- CreateIndex
CREATE INDEX "BranchProductVariantQuantityPrice_variantId_idx" ON "BranchProductVariantQuantityPrice"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProductVariantQuantityPrice_branchProductId_variantId_key" ON "BranchProductVariantQuantityPrice"("branchProductId", "variantId", "minQty");

-- AddForeignKey
ALTER TABLE "BranchProductVariantQuantityPrice" ADD CONSTRAINT "BranchProductVariantQuantityPrice_branchProductId_fkey" FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProductVariantQuantityPrice" ADD CONSTRAINT "BranchProductVariantQuantityPrice_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
