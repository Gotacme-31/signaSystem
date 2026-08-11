ALTER TABLE "ProductProductionConfig"
  ADD COLUMN "extraProductionThresholdQty" DECIMAL(12,3);

ALTER TABLE "ProductProductionConfig"
  ADD CONSTRAINT "ProductProductionConfig_extraProductionThresholdQty_check"
  CHECK (
    "extraProductionThresholdQty" IS NULL
    OR "extraProductionThresholdQty" > 0
  );

UPDATE "ProductionDailyExtraCapacity" AS extra
SET
  "isActive" = false,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE extra."isActive" = true
  AND NOT EXISTS (
    SELECT 1
    FROM "ProductionCapacityWindow" AS pcw
    WHERE pcw."configId" = extra."configId"
      AND pcw."dayOfWeek" = extra."dayOfWeek"
      AND pcw."isActive" = true
  );
