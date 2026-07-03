DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionBatchStatus') THEN
    CREATE TYPE "ProductionBatchStatus" AS ENUM ('OPEN', 'FULL', 'CLOSED', 'COMPLETED', 'CANCELLED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionScheduleStatus') THEN
    CREATE TYPE "ProductionScheduleStatus" AS ENUM ('NOT_REQUIRED', 'AUTO_SCHEDULED', 'AUTO_OVERFLOW_ESTIMATED', 'MANUAL_REQUIRED', 'MANUAL_SET', 'FAILED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionScheduleSource') THEN
    CREATE TYPE "ProductionScheduleSource" AS ENUM ('NONE', 'AUTO', 'MANUAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionOverflowMode') THEN
    CREATE TYPE "ProductionOverflowMode" AS ENUM ('AUTO_ESTIMATE', 'REQUIRE_MANUAL');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionTargetWindow') THEN
    CREATE TYPE "ProductionTargetWindow" AS ENUM ('NEXT_AVAILABLE', 'FIRST_OF_DAY', 'LAST_OF_DAY');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionBatchItemStatus') THEN
    CREATE TYPE "ProductionBatchItemStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'COMPLETED');
  END IF;
END $$;

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "autoEstimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "productionScheduleStatus" "ProductionScheduleStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS "productionScheduleSource" "ProductionScheduleSource" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "productionScheduleMessage" TEXT;

CREATE INDEX IF NOT EXISTS "Order_estimatedReadyAt_idx" ON "Order"("estimatedReadyAt");
CREATE INDEX IF NOT EXISTS "Order_productionScheduleStatus_idx" ON "Order"("productionScheduleStatus");
CREATE INDEX IF NOT EXISTS "Order_productionScheduleSource_idx" ON "Order"("productionScheduleSource");

CREATE TABLE IF NOT EXISTS "ProductProductionConfig" (
  "id" SERIAL NOT NULL,
  "branchId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "capacityUnit" "UnitType" NOT NULL DEFAULT 'METER',
  "allowSplitItems" BOOLEAN NOT NULL DEFAULT false,
  "manualOverrideAllowed" BOOLEAN NOT NULL DEFAULT true,
  "overflowMode" "ProductionOverflowMode" NOT NULL DEFAULT 'AUTO_ESTIMATE',
  "overflowDelayBusinessDays" INTEGER NOT NULL DEFAULT 1,
  "overflowTargetWindow" "ProductionTargetWindow" NOT NULL DEFAULT 'LAST_OF_DAY',
  "minLeadMinutes" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductProductionConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductProductionConfig_branchId_productId_key"
  ON "ProductProductionConfig"("branchId", "productId");
CREATE INDEX IF NOT EXISTS "ProductProductionConfig_branchId_idx"
  ON "ProductProductionConfig"("branchId");
CREATE INDEX IF NOT EXISTS "ProductProductionConfig_productId_idx"
  ON "ProductProductionConfig"("productId");

CREATE TABLE IF NOT EXISTS "ProductionCapacityWindow" (
  "id" SERIAL NOT NULL,
  "configId" INTEGER NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "startsAt" TEXT NOT NULL,
  "endsAt" TEXT NOT NULL,
  "readyAt" TEXT NOT NULL,
  "capacityQty" DECIMAL(12,3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionCapacityWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductionCapacityWindow_configId_idx"
  ON "ProductionCapacityWindow"("configId");
CREATE INDEX IF NOT EXISTS "ProductionCapacityWindow_configId_dayOfWeek_isActive_idx"
  ON "ProductionCapacityWindow"("configId", "dayOfWeek", "isActive");
CREATE INDEX IF NOT EXISTS "ProductionCapacityWindow_dayOfWeek_isActive_idx"
  ON "ProductionCapacityWindow"("dayOfWeek", "isActive");

CREATE TABLE IF NOT EXISTS "ProductionQuantityRule" (
  "id" SERIAL NOT NULL,
  "configId" INTEGER NOT NULL,
  "minQty" DECIMAL(12,3) NOT NULL,
  "maxQty" DECIMAL(12,3),
  "delayBusinessDays" INTEGER NOT NULL DEFAULT 0,
  "targetWindow" "ProductionTargetWindow" NOT NULL DEFAULT 'NEXT_AVAILABLE',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionQuantityRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductionQuantityRule_configId_idx"
  ON "ProductionQuantityRule"("configId");
CREATE INDEX IF NOT EXISTS "ProductionQuantityRule_configId_isActive_priority_idx"
  ON "ProductionQuantityRule"("configId", "isActive", "priority");

CREATE TABLE IF NOT EXISTS "ProductionBatch" (
  "id" SERIAL NOT NULL,
  "branchId" INTEGER NOT NULL,
  "productId" INTEGER NOT NULL,
  "windowId" INTEGER NOT NULL,
  "productionDate" TIMESTAMP(3) NOT NULL,
  "windowStartAt" TIMESTAMP(3) NOT NULL,
  "windowEndAt" TIMESTAMP(3) NOT NULL,
  "readyAt" TIMESTAMP(3) NOT NULL,
  "capacityQty" DECIMAL(12,3) NOT NULL,
  "reservedQty" DECIMAL(12,3) NOT NULL DEFAULT 0,
  "status" "ProductionBatchStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionBatch_branchId_productId_windowId_productionDate_key"
  ON "ProductionBatch"("branchId", "productId", "windowId", "productionDate");
CREATE INDEX IF NOT EXISTS "ProductionBatch_branchId_productionDate_idx"
  ON "ProductionBatch"("branchId", "productionDate");
CREATE INDEX IF NOT EXISTS "ProductionBatch_productId_productionDate_idx"
  ON "ProductionBatch"("productId", "productionDate");
CREATE INDEX IF NOT EXISTS "ProductionBatch_windowId_idx"
  ON "ProductionBatch"("windowId");
CREATE INDEX IF NOT EXISTS "ProductionBatch_readyAt_idx"
  ON "ProductionBatch"("readyAt");

CREATE TABLE IF NOT EXISTS "ProductionBatchItem" (
  "id" SERIAL NOT NULL,
  "batchId" INTEGER NOT NULL,
  "orderId" INTEGER NOT NULL,
  "orderItemId" INTEGER NOT NULL,
  "quantityAssigned" DECIMAL(12,3) NOT NULL,
  "status" "ProductionBatchItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionBatchItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionBatchItem_orderItemId_key"
  ON "ProductionBatchItem"("orderItemId");
CREATE INDEX IF NOT EXISTS "ProductionBatchItem_batchId_idx"
  ON "ProductionBatchItem"("batchId");
CREATE INDEX IF NOT EXISTS "ProductionBatchItem_orderId_idx"
  ON "ProductionBatchItem"("orderId");
CREATE INDEX IF NOT EXISTS "ProductionBatchItem_status_idx"
  ON "ProductionBatchItem"("status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductProductionConfig_branchId_fkey'
      AND table_name = 'ProductProductionConfig'
  ) THEN
    ALTER TABLE "ProductProductionConfig"
      ADD CONSTRAINT "ProductProductionConfig_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductProductionConfig_productId_fkey'
      AND table_name = 'ProductProductionConfig'
  ) THEN
    ALTER TABLE "ProductProductionConfig"
      ADD CONSTRAINT "ProductProductionConfig_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionCapacityWindow_configId_fkey'
      AND table_name = 'ProductionCapacityWindow'
  ) THEN
    ALTER TABLE "ProductionCapacityWindow"
      ADD CONSTRAINT "ProductionCapacityWindow_configId_fkey"
      FOREIGN KEY ("configId") REFERENCES "ProductProductionConfig"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionQuantityRule_configId_fkey'
      AND table_name = 'ProductionQuantityRule'
  ) THEN
    ALTER TABLE "ProductionQuantityRule"
      ADD CONSTRAINT "ProductionQuantityRule_configId_fkey"
      FOREIGN KEY ("configId") REFERENCES "ProductProductionConfig"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatch_branchId_fkey'
      AND table_name = 'ProductionBatch'
  ) THEN
    ALTER TABLE "ProductionBatch"
      ADD CONSTRAINT "ProductionBatch_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatch_productId_fkey'
      AND table_name = 'ProductionBatch'
  ) THEN
    ALTER TABLE "ProductionBatch"
      ADD CONSTRAINT "ProductionBatch_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatch_windowId_fkey'
      AND table_name = 'ProductionBatch'
  ) THEN
    ALTER TABLE "ProductionBatch"
      ADD CONSTRAINT "ProductionBatch_windowId_fkey"
      FOREIGN KEY ("windowId") REFERENCES "ProductionCapacityWindow"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatchItem_batchId_fkey'
      AND table_name = 'ProductionBatchItem'
  ) THEN
    ALTER TABLE "ProductionBatchItem"
      ADD CONSTRAINT "ProductionBatchItem_batchId_fkey"
      FOREIGN KEY ("batchId") REFERENCES "ProductionBatch"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatchItem_orderId_fkey'
      AND table_name = 'ProductionBatchItem'
  ) THEN
    ALTER TABLE "ProductionBatchItem"
      ADD CONSTRAINT "ProductionBatchItem_orderId_fkey"
      FOREIGN KEY ("orderId") REFERENCES "Order"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProductionBatchItem_orderItemId_fkey'
      AND table_name = 'ProductionBatchItem'
  ) THEN
    ALTER TABLE "ProductionBatchItem"
      ADD CONSTRAINT "ProductionBatchItem_orderItemId_fkey"
      FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
