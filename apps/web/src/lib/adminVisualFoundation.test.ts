import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adminNavigationForRole,
  isAdminNavigationItemActive,
} from "../navigation/adminNavigation";

const sidebar = readFileSync(
  resolve(process.cwd(), "src/components/admin/AdminSidebar.tsx"),
  "utf8"
);
const shell = readFileSync(
  resolve(process.cwd(), "src/components/admin/AdminShell.tsx"),
  "utf8"
);

test("visual foundation preserves every ADMIN navigation destination", () => {
  const items = adminNavigationForRole("ADMIN").flatMap((section) => section.items);
  assert.deepEqual(items.map((item) => [item.label, item.to]), [
    ["Pedidos activos", "/orders"],
    ["Pedidos entregados", "/admin/pedidos-entregados"],
    ["Productos", "/admin/pricing"],
    ["Inventario de productos", "/admin/inventory"],
    ["Suministros", "/admin/supplies-inventory"],
    ["Grupos de precios", "/admin/pricing-groups"],
    ["Personal", "/admin/branches"],
    ["Dashboard", "/admin/dashboard"],
  ]);
  assert.deepEqual(adminNavigationForRole("STAFF"), []);
  assert.match(sidebar, /to=\{item\.to\}/);
});

test("sidebar keeps route matching, active state and logout wiring", () => {
  const products = adminNavigationForRole("ADMIN")
    .flatMap((section) => section.items)
    .find((item) => item.label === "Productos");
  assert.ok(products);
  assert.equal(isAdminNavigationItemActive(products, "/admin/products/42"), true);
  assert.match(sidebar, /isAdminNavigationItemActive\(item, location\.pathname\)/);
  assert.match(sidebar, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(sidebar, /onClick=\{onLogout\}/);
});

test("mobile drawer retains focus, Escape, navigation and scroll handlers", () => {
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(shell, /menuButtonRef\.current\?\.focus\(\)/);
  assert.match(shell, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(shell, /onNavigate=\{\(\) => closeDrawer\(\)\}/);
  assert.match(shell, /onLogout=\{handleLogout\}/);
});

test("mobile drawer is opaque and layered above its backdrop", () => {
  const backdropClassName = shell.match(
    /aria-label="Cerrar navegación"[\s\S]*?tabIndex=\{-1\}[\s\S]*?className="([^"]+)"/
  )?.[1];
  const drawerClassName = shell.match(
    /id="admin-mobile-navigation"[\s\S]*?className="([^"]+)"/
  )?.[1];

  assert.ok(backdropClassName);
  assert.match(backdropClassName, /\bfixed\b/);
  assert.match(backdropClassName, /\binset-0\b/);
  assert.match(backdropClassName, /\bz-40\b/);
  assert.match(backdropClassName, /\bbg-slate-950\/50\b/);

  assert.ok(drawerClassName);
  assert.match(drawerClassName, /\bfixed\b/);
  assert.match(drawerClassName, /\binset-y-0\b/);
  assert.match(drawerClassName, /\bleft-0\b/);
  assert.match(drawerClassName, /\bz-50\b/);
  assert.match(drawerClassName, /\bbg-surface\b/);
  assert.doesNotMatch(drawerClassName, /(?:^|\s)(?:opacity-\S+|bg-\S+\/\d+)(?:\s|$)/);
});

test("sidebar uses the light semantic palette without the old active elevation", () => {
  assert.match(sidebar, /bg-brand-soft\/30/);
  assert.match(sidebar, /bg-surface text-brand shadow-surface/);
  assert.doesNotMatch(sidebar, /bg-slate-950 text-white/);
  assert.doesNotMatch(sidebar, /shadow-lg shadow-indigo-950/);
});
