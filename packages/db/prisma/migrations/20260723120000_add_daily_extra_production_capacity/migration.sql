DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionCapacityStrategy') THEN
    CREATE TYPE "ProductionCapacityStrategy" AS ENUM ('NORMAL', 'EXTRA_PREFERRED');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductionBatchKind') THEN
    CREATE TYPE "ProductionBatchKind" AS ENUM ('NORMAL_WINDOW', 'EXTRA_DAILY');
  END IF;
END $$;

ALTER TABLE "ProductionQuantityRule"
  ADD COLUMN IF NOT EXISTS "capacityStrategy" "ProductionCapacityStrategy" NOT NULL DEFAULT 'NORMAL';

CREATE TABLE IF NOT EXISTS "ProductionDailyExtraCapacity" (
  "id" SERIAL NOT NULL,
  "configId" INTEGER NOT NULL,
  "dayOfWeek" INTEGER NOT NULL,
  "capacityQty" DECIMAL(12,3) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductionDailyExtraCapacity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProductionDailyExtraCapacity_dayOfWeek_check" CHECK ("dayOfWeek" BETWEEN 0 AND 6),
  CONSTRAINT "ProductionDailyExtraCapacity_capacity_check" CHECK (
    "capacityQty" >= 0 AND (NOT "isActive" OR "capacityQty" > 0)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionDailyExtraCapacity_configId_dayOfWeek_key"
  ON "ProductionDailyExtraCapacity"("configId", "dayOfWeek");
CREATE INDEX IF NOT EXISTS "ProductionDailyExtraCapacity_configId_isActive_idx"
  ON "ProductionDailyExtraCapacity"("configId", "isActive");
CREATE INDEX IF NOT EXISTS "ProductionDailyExtraCapacity_dayOfWeek_isActive_idx"
  ON "ProductionDailyExtraCapacity"("dayOfWeek", "isActive");

ALTER TABLE "ProductionBatch"
  ADD COLUMN IF NOT EXISTS "kind" "ProductionBatchKind" NOT NULL DEFAULT 'NORMAL_WINDOW',
  ADD COLUMN IF NOT EXISTS "extraCapacityId" INTEGER,
  ALTER COLUMN "windowId" DROP NOT NULL,
  ALTER COLUMN "windowStartAt" DROP NOT NULL,
  ALTER COLUMN "windowEndAt" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ProductionBatch_extraCapacityId_productionDate_key"
  ON "ProductionBatch"("extraCapacityId", "productionDate");
CREATE INDEX IF NOT EXISTS "ProductionBatch_extraCapacityId_idx"
  ON "ProductionBatch"("extraCapacityId");
CREATE INDEX IF NOT EXISTS "ProductionBatch_kind_productionDate_idx"
  ON "ProductionBatch"("kind", "productionDate");

ALTER TABLE "ProductionQuantityRule"
  ADD CONSTRAINT "ProductionQuantityRule_extra_strategy_check" CHECK (
    "capacityStrategy" <> 'EXTRA_PREFERRED'
    OR ("delayBusinessDays" = 0 AND "targetWindow" = 'LAST_OF_DAY')
  );

ALTER TABLE "ProductionBatch"
  ADD CONSTRAINT "ProductionBatch_capacity_source_check" CHECK (
    (
      "kind" = 'NORMAL_WINDOW'
      AND "windowId" IS NOT NULL
      AND "extraCapacityId" IS NULL
      AND "windowStartAt" IS NOT NULL
      AND "windowEndAt" IS NOT NULL
    )
    OR
    (
      "kind" = 'EXTRA_DAILY'
      AND "windowId" IS NULL
      AND "extraCapacityId" IS NOT NULL
      AND "windowStartAt" IS NULL
      AND "windowEndAt" IS NULL
    )
  );

ALTER TABLE "ProductionDailyExtraCapacity"
  ADD CONSTRAINT "ProductionDailyExtraCapacity_configId_fkey"
  FOREIGN KEY ("configId") REFERENCES "ProductProductionConfig"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductionBatch"
  ADD CONSTRAINT "ProductionBatch_extraCapacityId_fkey"
  FOREIGN KEY ("extraCapacityId") REFERENCES "ProductionDailyExtraCapacity"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
