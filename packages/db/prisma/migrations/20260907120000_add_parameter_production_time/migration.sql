ALTER TABLE "BranchProductParamPrice"
ADD COLUMN "productionTimeMinutesPerUnit" INTEGER,
ADD CONSTRAINT "BranchProductParamPrice_productionTimeMinutesPerUnit_check"
CHECK (
  "productionTimeMinutesPerUnit" IS NULL
  OR "productionTimeMinutesPerUnit" >= 0
);

ALTER TABLE "OrderItemOption"
ADD COLUMN "appliedTimeMinutesPerUnit" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "appliedExtraTimeMinutes" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "OrderItemOption_appliedTimeMinutesPerUnit_check"
CHECK ("appliedTimeMinutesPerUnit" >= 0),
ADD CONSTRAINT "OrderItemOption_appliedExtraTimeMinutes_check"
CHECK ("appliedExtraTimeMinutes" >= 0);

ALTER TABLE "OrderItem"
ADD COLUMN "baseProductionReadyAt" TIMESTAMP(3);
