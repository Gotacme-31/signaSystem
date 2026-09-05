-- CreateEnum
CREATE TYPE "SupplyMovementType" AS ENUM (
  'INITIAL_STOCK',
  'RESTOCK',
  'MANUAL_REMOVE',
  'ADJUSTMENT'
);

-- CreateTable
CREATE TABLE "SupplyItem" (
  "id" SERIAL NOT NULL,
  "branchId" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "normalizedName" TEXT NOT NULL,
  "unitLabel" TEXT NOT NULL,
  "currentStock" INTEGER NOT NULL DEFAULT 0,
  "lowStockThreshold" INTEGER,
  "version" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "creationOperationKey" TEXT,
  "creationRequestHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SupplyItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplyItem_name_check" CHECK (CHAR_LENGTH(BTRIM("name")) BETWEEN 1 AND 120),
  CONSTRAINT "SupplyItem_normalizedName_check" CHECK (CHAR_LENGTH(BTRIM("normalizedName")) BETWEEN 1 AND 120),
  CONSTRAINT "SupplyItem_unitLabel_check" CHECK (CHAR_LENGTH(BTRIM("unitLabel")) BETWEEN 1 AND 40),
  CONSTRAINT "SupplyItem_currentStock_check" CHECK ("currentStock" >= 0),
  CONSTRAINT "SupplyItem_lowStockThreshold_check" CHECK ("lowStockThreshold" IS NULL OR "lowStockThreshold" >= 0),
  CONSTRAINT "SupplyItem_version_check" CHECK ("version" >= 0),
  CONSTRAINT "SupplyItem_creation_idempotency_pair_check" CHECK (
    ("creationOperationKey" IS NULL AND "creationRequestHash" IS NULL)
    OR ("creationOperationKey" IS NOT NULL AND "creationRequestHash" IS NOT NULL)
  ),
  CONSTRAINT "SupplyItem_creationOperationKey_check" CHECK (
    "creationOperationKey" IS NULL
    OR CHAR_LENGTH(BTRIM("creationOperationKey")) BETWEEN 8 AND 100
  ),
  CONSTRAINT "SupplyItem_creationRequestHash_check" CHECK (
    "creationRequestHash" IS NULL
    OR "creationRequestHash" ~ '^[0-9a-f]{64}$'
  )
);

-- CreateTable
CREATE TABLE "SupplyMovement" (
  "id" SERIAL NOT NULL,
  "supplyItemId" INTEGER NOT NULL,
  "deltaQty" INTEGER NOT NULL,
  "stockBefore" INTEGER NOT NULL,
  "stockAfter" INTEGER NOT NULL,
  "movementType" "SupplyMovementType" NOT NULL,
  "reason" TEXT,
  "createdById" INTEGER,
  "operationKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplyMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SupplyMovement_stockBefore_check" CHECK ("stockBefore" >= 0),
  CONSTRAINT "SupplyMovement_stockAfter_check" CHECK ("stockAfter" >= 0),
  CONSTRAINT "SupplyMovement_stock_consistency_check" CHECK ("stockAfter" = "stockBefore" + "deltaQty"),
  CONSTRAINT "SupplyMovement_delta_type_check" CHECK (
    ("movementType" = 'INITIAL_STOCK' AND "stockBefore" = 0 AND "deltaQty" > 0)
    OR ("movementType" = 'RESTOCK' AND "deltaQty" > 0)
    OR ("movementType" = 'MANUAL_REMOVE' AND "deltaQty" < 0)
    OR ("movementType" = 'ADJUSTMENT' AND "deltaQty" <> 0)
  ),
  CONSTRAINT "SupplyMovement_reason_check" CHECK (
    "movementType" NOT IN ('MANUAL_REMOVE', 'ADJUSTMENT')
    OR NULLIF(BTRIM("reason"), '') IS NOT NULL
  ),
  CONSTRAINT "SupplyMovement_reason_length_check" CHECK ("reason" IS NULL OR CHAR_LENGTH("reason") <= 500),
  CONSTRAINT "SupplyMovement_operationKey_check" CHECK (CHAR_LENGTH(BTRIM("operationKey")) BETWEEN 8 AND 100),
  CONSTRAINT "SupplyMovement_requestHash_check" CHECK ("requestHash" ~ '^[0-9a-f]{64}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "SupplyItem_branchId_normalizedName_key"
ON "SupplyItem"("branchId", "normalizedName");
CREATE UNIQUE INDEX "SupplyItem_creationOperationKey_key"
ON "SupplyItem"("creationOperationKey");
CREATE INDEX "SupplyItem_branchId_isActive_name_idx"
ON "SupplyItem"("branchId", "isActive", "name");
CREATE UNIQUE INDEX "SupplyMovement_operationKey_key"
ON "SupplyMovement"("operationKey");
CREATE UNIQUE INDEX "SupplyMovement_initialStock_key"
ON "SupplyMovement"("supplyItemId")
WHERE "movementType" = 'INITIAL_STOCK';
CREATE INDEX "SupplyMovement_supplyItemId_createdAt_id_idx"
ON "SupplyMovement"("supplyItemId", "createdAt", "id");
CREATE INDEX "SupplyMovement_createdById_idx"
ON "SupplyMovement"("createdById");
CREATE INDEX "SupplyMovement_movementType_createdAt_idx"
ON "SupplyMovement"("movementType", "createdAt");

-- AddForeignKey
ALTER TABLE "SupplyItem" ADD CONSTRAINT "SupplyItem_branchId_fkey"
FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplyMovement" ADD CONSTRAINT "SupplyMovement_supplyItemId_fkey"
FOREIGN KEY ("supplyItemId") REFERENCES "SupplyItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplyMovement" ADD CONSTRAINT "SupplyMovement_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
