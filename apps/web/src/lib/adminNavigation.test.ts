import assert from "node:assert/strict";
import test from "node:test";
import {
  adminNavigationForRole,
  isAdminNavigationItemActive,
} from "../navigation/adminNavigation";

function item(label: string) {
  const result = adminNavigationForRole("ADMIN")
    .flatMap((section) => section.items)
    .find((candidate) => candidate.label === label);
  assert.ok(result);
  return result;
}

test("admin navigation is visible only for ADMIN", () => {
  assert.equal(adminNavigationForRole("ADMIN").length, 3);
  assert.deepEqual(adminNavigationForRole("STAFF"), []);
  assert.deepEqual(adminNavigationForRole("COUNTER"), []);
  assert.deepEqual(adminNavigationForRole("MULTI_COUNTER"), []);
  assert.deepEqual(adminNavigationForRole("PRODUCTION"), []);
  assert.deepEqual(adminNavigationForRole("PAYMENTS"), []);
  assert.deepEqual(adminNavigationForRole(undefined), []);
});

test("pricing and pricing groups cannot be active together", () => {
  const pricing = item("Productos");
  const groups = item("Grupos de precios");

  assert.equal(isAdminNavigationItemActive(pricing, "/admin/pricing"), true);
  assert.equal(isAdminNavigationItemActive(pricing, "/admin/pricing-groups"), false);
  assert.equal(isAdminNavigationItemActive(groups, "/admin/pricing-groups"), true);
});

test("product create and edit routes mark Productos active", () => {
  const pricing = item("Productos");

  assert.equal(isAdminNavigationItemActive(pricing, "/admin/products/new"), true);
  assert.equal(isAdminNavigationItemActive(pricing, "/admin/products/42"), true);
});

test("inventory has its own active ADMIN destination", () => {
  const inventory = item("Inventario");
  const pricing = item("Productos");

  assert.equal(isAdminNavigationItemActive(inventory, "/admin/inventory"), true);
  assert.equal(isAdminNavigationItemActive(pricing, "/admin/inventory"), false);
});
