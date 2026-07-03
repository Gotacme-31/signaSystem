ALTER TABLE "ProductProductionConfig"
  DROP COLUMN IF EXISTS "capacityUnit",
  DROP COLUMN IF EXISTS "allowSplitItems",
  DROP COLUMN IF EXISTS "manualOverrideAllowed",
  DROP COLUMN IF EXISTS "overflowMode",
  DROP COLUMN IF EXISTS "overflowDelayBusinessDays",
  DROP COLUMN IF EXISTS "overflowTargetWindow",
  DROP COLUMN IF EXISTS "minLeadMinutes";

ALTER TABLE "ProductionCapacityWindow"
  DROP COLUMN IF EXISTS "sortOrder";

DROP INDEX IF EXISTS "ProductionQuantityRule_configId_isActive_priority_idx";

ALTER TABLE "ProductionQuantityRule"
  DROP COLUMN IF EXISTS "priority";

CREATE INDEX IF NOT EXISTS "ProductionQuantityRule_configId_isActive_minQty_maxQty_idx"
  ON "ProductionQuantityRule"("configId", "isActive", "minQty", "maxQty");

ALTER TABLE "ProductionBatchItem"
  ADD COLUMN IF NOT EXISTS "source" "ProductionScheduleSource" NOT NULL DEFAULT 'AUTO';

DROP INDEX IF EXISTS "ProductionBatchItem_orderItemId_key";

ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "autoEstimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "manualReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estimatedReadyAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "productionScheduleStatus" "ProductionScheduleStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS "productionScheduleSource" "ProductionScheduleSource" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "productionScheduleMessage" TEXT;

CREATE INDEX IF NOT EXISTS "OrderItem_estimatedReadyAt_idx" ON "OrderItem"("estimatedReadyAt");
CREATE INDEX IF NOT EXISTS "OrderItem_productionScheduleStatus_idx" ON "OrderItem"("productionScheduleStatus");
CREATE INDEX IF NOT EXISTS "OrderItem_productionScheduleSource_idx" ON "OrderItem"("productionScheduleSource");

DROP TYPE IF EXISTS "ProductionOverflowMode";
