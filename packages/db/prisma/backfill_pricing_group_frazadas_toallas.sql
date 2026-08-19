-- Run manually only after the structural pricing-groups migration and before
-- deploying the backend that removes the legacy combined-pricing hardcode.
BEGIN;

DO $$
DECLARE
  pricing_group_id INTEGER;
BEGIN
  PERFORM 1
  FROM "Product"
  WHERE "id" IN (2, 6)
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM "Product"
    WHERE "id" = 2
      AND "name" = 'Frazada'
      AND "unitType" = 'PIECE'
      AND "isCustomProductTemplate" = false
  ) THEN
    RAISE EXCEPTION 'Product 2 no es la Frazada PIECE esperada';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Product"
    WHERE "id" = 6
      AND "name" = 'Toalla'
      AND "unitType" = 'PIECE'
      AND "isCustomProductTemplate" = false
  ) THEN
    RAISE EXCEPTION 'Product 6 no es la Toalla PIECE esperada';
  END IF;

  SELECT "id"
  INTO pricing_group_id
  FROM "PricingGroup"
  WHERE "name" = 'Frazadas y Toallas'
  FOR UPDATE;

  IF pricing_group_id IS NULL THEN
    INSERT INTO "PricingGroup" (
      "name",
      "unitType",
      "isActive",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      'Frazadas y Toallas',
      'PIECE',
      true,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING "id" INTO pricing_group_id;
  ELSE
    IF EXISTS (
      SELECT 1
      FROM "PricingGroup"
      WHERE "id" = pricing_group_id
        AND "unitType" <> 'PIECE'
    ) THEN
      RAISE EXCEPTION 'El grupo Frazadas y Toallas existe con una unidad distinta de PIECE';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM "Product"
      WHERE "pricingGroupId" = pricing_group_id
        AND ("unitType" <> 'PIECE' OR "isCustomProductTemplate" = true)
    ) THEN
      RAISE EXCEPTION 'El grupo Frazadas y Toallas contiene miembros incompatibles';
    END IF;

    UPDATE "PricingGroup"
    SET "isActive" = true,
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = pricing_group_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Product"
    WHERE "id" IN (2, 6)
      AND "pricingGroupId" IS NOT NULL
      AND "pricingGroupId" <> pricing_group_id
  ) THEN
    RAISE EXCEPTION 'Frazada o Toalla ya pertenece a otro PricingGroup';
  END IF;

  UPDATE "Product"
  SET "pricingGroupId" = pricing_group_id
  WHERE "id" IN (2, 6);
END $$;

COMMIT;
