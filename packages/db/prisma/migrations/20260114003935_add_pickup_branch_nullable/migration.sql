-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pickupBranchId" INTEGER;

-- CreateIndex
CREATE INDEX "Order_pickupBranchId_stage_deliveryDate_idx" ON "Order"("pickupBranchId", "stage", "deliveryDate");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupBranchId_fkey" FOREIGN KEY ("pickupBranchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
