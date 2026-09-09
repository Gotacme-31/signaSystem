import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const newOrder = readFileSync(resolve(process.cwd(), "src/pages/NewOrder.tsx"), "utf8");
const editOrder = readFileSync(resolve(process.cwd(), "src/pages/components/EditOrderModal.tsx"), "utf8");
const pricingApi = readFileSync(resolve(process.cwd(), "src/api/pricing.ts"), "utf8");

test("NewOrder requests the explicit active catalog and guards stale branch responses", () => {
  assert.match(newOrder, /getOrderBranchProducts\(branchId, \{ mode: "new-order" \}\)/);
  assert.match(newOrder, /isLatestOrderCatalogRequest\(requestId, catalogRequestIdRef\.current\)/);
  assert.match(newOrder, /setCatalog\(\[\]\);\s*setItems\(\[\]\);/);
  assert.match(newOrder, /\}, \[branchId, catalogRefreshKey\]\);/);
  assert.doesNotMatch(newOrder, /\}, \[branchId, pickupBranchId, catalogRefreshKey\]\);/);
  assert.match(newOrder, /e\.code === "PRODUCT_NOT_AVAILABLE"/);
  assert.match(newOrder, /availableProductIds\.has\(item\.productId\)/);
});

test("pricing API keeps historical mode as the default", () => {
  assert.match(pricingApi, /const query = options\?\.mode \? `\?mode=\$\{options\.mode\}` : ""/);
});

test("EditOrderModal retains an inactive product already present in a historical order", () => {
  assert.match(editOrder, /r\.isActive \|\| existingProductIds\.has\(r\.productId\)/);
  assert.match(editOrder, /item\.product\?\.name \?\? item\.productNameSnapshot/);
});
