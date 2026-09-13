import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd(), "../..");
const page = readFileSync(resolve(root, "apps/web/src/pages/TrackOrderPage.tsx"), "utf8");
const app = readFileSync(resolve(root, "apps/web/src/App.tsx"), "utf8");
const activeOrders = readFileSync(resolve(root, "apps/web/src/pages/ActiveOrders.tsx"), "utf8");
const ticket = readFileSync(resolve(root, "apps/web/src/pages/components/TicketReceipt.tsx"), "utf8");
const permissions = readFileSync(resolve(root, "apps/web/src/lib/trackingPermissions.ts"), "utf8");

test("public page polls only while visible and protects against overlapping requests", () => {
  assert.match(page, /setInterval\(refreshWhenVisible, 60_000\)/);
  assert.match(page, /document\.visibilityState === "visible"/);
  assert.match(page, /PublicTrackingRequestCoordinator/);
  assert.match(page, /stateToken !== token/);
  assert.match(page, /Actualizar estado/);
  assert.match(page, /Pedido no encontrado/);
  assert.match(page, /role="status"/);
});

test("tracking route is outside protected and internal shell routes", () => {
  assert.match(app, /Route path="\/track\/:token" element={<TrackOrderPage \/>}/);
  assert.match(app, /Route path="\*" element={<InternalAppRoutes \/>}/);
});

test("authorized order actions copy links and ticket wraps an optional URL", () => {
  assert.match(activeOrders, /getOrderTrackingLink/);
  assert.match(activeOrders, /copyOrderTracking/);
  assert.match(activeOrders, /TrackingRequestCoordinator/);
  assert.match(activeOrders, /No se pudo copiar el seguimiento/);
  assert.match(activeOrders, /Copiar seguimiento/);
  assert.match(activeOrders, /Seguimiento copiado/);
  assert.match(activeOrders, /Regenerar enlace/);
  assert.match(ticket, /trackingUrl\?: string \| null/);
  assert.match(ticket, /break-all/);
  assert.match(ticket, /Seguimiento del pedido/);
  assert.match(ticket, /Pedido #\{order\.id/);
});

test("active order cards do not render public tracking controls", () => {
  const orderCardsStart = activeOrders.indexOf("{paginatedOrders.map((o) => {");
  const paginationStart = activeOrders.indexOf("{/* Paginación */}", orderCardsStart);
  assert.notEqual(orderCardsStart, -1);
  assert.notEqual(paginationStart, -1);

  const orderCards = activeOrders.slice(orderCardsStart, paginationStart);
  assert.match(orderCards, /Archivos del pedido[\s\S]*Items del pedido con colores mejorados/);
  assert.doesNotMatch(
    orderCards,
    /Seguimiento público|Comparte sólo el enlace|Copiar seguimiento|Regenerar enlace|trackingUrlsByOrderId\[o\.id\]|handleCopyTracking\(o\.id\)|handleRegenerateTracking\(o\.id\)/
  );
});

test("ticket preserves tracking and image controls", () => {
  const ticketControlsStart = activeOrders.indexOf("{/* Modal de ticket */}");
  const ticketPreviewStart = activeOrders.indexOf("{/* Ticket preview con scroll */}", ticketControlsStart);
  assert.notEqual(ticketControlsStart, -1);
  assert.notEqual(ticketPreviewStart, -1);

  const ticketControls = activeOrders.slice(ticketControlsStart, ticketPreviewStart);
  assert.match(ticketControls, /Copiar seguimiento/);
  assert.match(ticketControls, /handleCopyTracking\(Number\(ticketOrder\.id\)\)/);
  assert.match(ticketControls, /trackingLoadingOrderId/);
  assert.match(ticketControls, /canCopyTrackingAction &&/);
  assert.match(ticketControls, /Regenerar enlace/);
  assert.match(ticketControls, /handleRegenerateTracking\(Number\(ticketOrder\.id\)\)/);
  assert.match(ticketControls, /trackingRegeneratingOrderId/);
  assert.match(ticketControls, /canRegenerateTrackingAction &&/);
  assert.match(ticketControls, /onClick=\{handleCopyTicketImage\}[\s\S]*Copiar imagen/);
  assert.match(ticketControls, /onClick=\{handleDownloadTicketImage\}[\s\S]*Descargar imagen/);
  assert.match(ticketControls, /printTicket\(ticketOrder\)/);
});

test("ActiveOrders delegates tracking visibility to the exact role contract", () => {
  assert.match(permissions, /ADMIN.*STAFF.*COUNTER.*MULTI_COUNTER/);
  assert.match(permissions, /role === "ADMIN"/);
  assert.match(activeOrders, /canCopyTrackingAction/);
  assert.match(activeOrders, /canRegenerateTrackingAction/);
});
