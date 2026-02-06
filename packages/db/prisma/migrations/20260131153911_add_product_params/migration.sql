/*
  Warnings:

  - You are about to drop the column `priceDelta` on the `ProductParam` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ProductParam" DROP COLUMN "priceDelta",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "BranchProductParamPrice" (
    "id" SERIAL NOT NULL,
    "branchProductId" INTEGER NOT NULL,
    "paramId" INTEGER NOT NULL,
    "priceDelta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchProductParamPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchProductParamPrice_branchProductId_idx" ON "BranchProductParamPrice"("branchProductId");

-- CreateIndex
CREATE INDEX "BranchProductParamPrice_paramId_idx" ON "BranchProductParamPrice"("paramId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchProductParamPrice_branchProductId_paramId_key" ON "BranchProductParamPrice"("branchProductId", "paramId");

-- AddForeignKey
ALTER TABLE "BranchProductParamPrice" ADD CONSTRAINT "BranchProductParamPrice_branchProductId_fkey" FOREIGN KEY ("branchProductId") REFERENCES "BranchProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchProductParamPrice" ADD CONSTRAINT "BranchProductParamPrice_paramId_fkey" FOREIGN KEY ("paramId") REFERENCES "ProductParam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
