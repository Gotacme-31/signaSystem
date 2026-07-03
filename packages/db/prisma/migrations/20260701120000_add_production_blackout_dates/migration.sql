CREATE TABLE "ProductionBlackoutDate" (
  "id" SERIAL NOT NULL,
  "branchId" INTEGER,
  "productId" INTEGER,
  "date" TIMESTAMP(3) NOT NULL,
  "reason" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductionBlackoutDate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductionBlackoutDate_branchId_idx" ON "ProductionBlackoutDate"("branchId");
CREATE INDEX "ProductionBlackoutDate_productId_idx" ON "ProductionBlackoutDate"("productId");
CREATE INDEX "ProductionBlackoutDate_date_idx" ON "ProductionBlackoutDate"("date");
CREATE INDEX "ProductionBlackoutDate_isActive_idx" ON "ProductionBlackoutDate"("isActive");

ALTER TABLE "ProductionBlackoutDate"
  ADD CONSTRAINT "ProductionBlackoutDate_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionBlackoutDate"
  ADD CONSTRAINT "ProductionBlackoutDate_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
