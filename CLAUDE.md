# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workspace

pnpm monorepo (`pnpm-workspace.yaml`) with two apps and one shared package:

- `apps/api` — Express + Socket.IO backend (port 3001)
- `apps/web` — React 19 + Vite + Tailwind frontend (port 5173)
- `packages/db` — Prisma + PostgreSQL shared package (`@signa/db`), consumed by `apps/api`

## Commands

```sh
# Setup
pnpm install
docker compose up -d          # local Postgres (signa_db) on :5432

# Prisma (schema lives in packages/db, not apps/api)
pnpm --filter @signa/db prisma:generate   # or: pnpm --filter api prisma:generate (also regenerates client)
pnpm --filter @signa/db prisma:deploy     # apply migrations
pnpm --filter @signa/db seed              # runs packages/db/prisma/seed.ts via tsx

# API (apps/api)
pnpm --filter api dev             # tsx src/index.ts, port 3001
pnpm --filter api build           # tsc -p tsconfig.json -> dist/
pnpm --filter api test            # node's test runner over src/services/*.test.ts + src/middlewares/*.test.ts
pnpm --filter api test:production-capacity   # narrower run: src/services/production-capacity-*.test.ts

# Run a single API test file directly:
cd apps/api && tsx --test src/services/order-pricing.service.test.ts

# Web (apps/web)
pnpm --filter web dev             # Vite dev server, proxies /api and /dashboard to :3001
pnpm --filter web lint            # ESLint flat config
pnpm --filter web build           # tsc -b && vite build
pnpm --filter web test            # node's test runner over src/lib/*.test.ts

# Run a single web test file directly:
cd apps/web && tsx --test src/lib/groupPricing.test.ts
```

There is no root-level test/build/lint script — always run these `--filter`ed per package or `cd` into the package first.

## Architecture

### Domain model (`packages/db/prisma/schema.prisma`)

This is an order-management system for a printing/signage business with multiple branches. Key concepts:

- **Branch** — a physical location. Orders have both a `branchId` (production/counter branch) and a `pickupBranchId` (where the customer collects), which can differ.
- **User roles**: `ADMIN`, `STAFF`, `COUNTER`, `MULTI_COUNTER`, `PAYMENTS`, `PRODUCTION`. `MULTI_COUNTER` users get extra branch access via `UserBranchAccess`; everyone else is scoped to their single `branchId`. `apps/api/src/lib/branchAccess.ts` (`getAccessibleBranchIdsForUser`, `branchScopeWhere`, `canAccessOrderByBranches`) is the shared logic for branch-scoping queries and access checks — reuse it rather than reimplementing per-controller.
- **Order** lifecycle: `OrderStage` (`REGISTERED` → `IN_PROGRESS` → `READY` → `DELIVERED`), independent from `ProductionScheduleStatus`/`ProductionScheduleSource` (auto vs. manual production scheduling) and `ShippingStage` (`SHIPPED`/`RECEIVED`, only for `DELIVERY` shipping type). An `Order` has many `OrderItem`s, each with its own production step tracking (`OrderItemStep`, `productionStep`, `currentStepOrder`).
- **Pricing** is layered and branch-specific: `BranchProduct` (base price per branch) → `BranchProductQuantityPrice` (qty breakpoints) → variant and variant+quantity price tables → `PricingGroup` (cross-product bulk pricing, e.g. shared tiers for related products) → `ProductParam`/`BranchProductParamPrice` (add-on charges per meter/piece) → `ProductOptionGroup`/`ProductOption` (choice-based add-ons). `order-pricing.service.ts` is the source of truth for resolving all of this into a final `unitPrice`/`subtotal`.
- **Inventory** has two independent systems that must not be confused:
  - `BranchInventoryConfig`/`BranchInventoryBalance`/`InventoryMovement` — per-branch, per-product-or-variant stock tracked against sellable `BranchProduct`s, decremented on order creation/edit/cancellation (`inventory.service.ts`).
  - `SupplyItem`/`SupplyMovement` — separate raw-materials/supplies stock per branch, unrelated to sellable products (`supply-inventory.service.ts`).
  - Both use optimistic concurrency (`version` column) and a unique `operationKey` on movements to make writes idempotent under concurrent requests — follow this pattern for any new stock-mutating logic.
- **Production scheduling** (`production-scheduling.service.ts`, ~1700 lines — the most complex module) computes `estimatedReadyAt` per order item using `ProductProductionConfig` → `ProductionCapacityWindow` (recurring time slots per day-of-week) + `ProductionQuantityRule` (delay/targeting rules by quantity) + `ProductionDailyExtraCapacity` (extra daily overflow capacity) + `ProductionBlackoutDate`. Actual capacity consumption is tracked via `ProductionBatch`/`ProductionBatchItem`. `production-capacity-planner.ts` and `production-capacity-runtime.ts` split out the planning/runtime concerns; `business-time.ts` handles business-day/hour arithmetic used throughout.
- **Order idempotency**: order creation accepts a client-generated `clientRequestId` (unique) plus a `requestHash` of the normalized payload (see `order-idempotency.service.ts`) so retried requests are detected and rejected/deduped rather than double-submitted.
- **Order files**: uploaded originals/prepared files per order or order item, with a status lifecycle (`ACTIVE` → `PENDING_DELETE` → `DELETED`/`DELETE_FAILED`) and scheduled cleanup (`jobs/order-file-cleanup.job.ts`, `order-file-storage.service.ts`).
- **Public tracking**: orders can generate a `publicTrackingToken` for customer-facing order tracking (`public-tracking.controller.ts`/`.service.ts`, rate-limited by `publicTrackingRateLimit.ts`) — this is the only unauthenticated surface in the API.

### API layering

Routes (`src/routes`) are thin and mount `auth` (and sometimes `requireAdmin`/`requireStaff`) middleware, then delegate to controllers (`src/controllers`), which call into services (`src/services`) for business logic. Services generally take a Prisma transaction client so multi-step writes (pricing + inventory + scheduling + socket emit) commit atomically. Real-time updates to connected clients go through the `io` instance registered via `app.set("io", io)` in `index.ts` and consumed in controllers/services — see `socket/index.ts` for room conventions (`branch:<id>`, `role:<role>`, `user:<id>`, `admin`).

Auth is JWT-based (`Authorization: Bearer <token>`); `middlewares/auth.ts` re-fetches the user from the DB on every request (not just decoding the token) to catch deactivated users and populate `accessibleBranchIds`. The same JWT verification and room-joining logic is duplicated in `socket/index.ts` for the WebSocket handshake — keep both in sync if auth logic changes.

### API test conventions

Test files sit next to the code they test (`*.test.ts` in `src/services`/`src/middlewares`), run via Node's built-in test runner (`tsx --test`), not Jest/Vitest. Two distinct styles are used:
- Normal unit/integration tests that import and exercise the actual service functions.
- `*-source.test.ts` files (e.g. `order-hard-delete-source.test.ts`, `production-batch-cleanup-source.test.ts`) that `readFileSync` the target source file and assert on it with regexes instead of executing it — used to pin down structural invariants (e.g. "this controller must call `tx.order.delete` before X") that are hard to assert via behavior alone. Follow this existing pattern rather than introducing a new convention when adding this kind of check.
- Some Postgres-only concurrency tests (e.g. `inventory-postgres-concurrency.test.ts`) are skipped by default and only run when `RUN_INVENTORY_POSTGRES_TESTS=1` and a dedicated `INVENTORY_TEST_DATABASE_URL` (different from `DATABASE_URL`) are set, since they exercise real transaction serialization.

### Web app structure

- `src/pages` — route-level components; `src/pages/components` holds page-specific sub-components (modals, receipts).
- `src/api` — one file per resource, wrapping `src/api/http.ts`/`client.ts` (axios) for backend calls.
- `src/lib` — pure/testable business logic extracted out of components (pricing math, business-time math, filters, permissions) — this is where `*.test.ts` files live for the web app, mirroring the API's preference for testing logic outside of React components.
- `src/auth` — `AuthContext`/`ProtectedRoutes` gate routes by role, mirroring the API's role enum.
- `src/contexts/SocketContext.tsx` + `src/hooks/useSocket.ts` — Socket.IO client wiring, joins rooms matching the server-side convention.
- Routing is React Router v7 (`App.tsx`); admin-only pages are nested under `AdminLayout`/`AdminShell`/`AdminSidebar`.
- ESLint flat config (`eslint.config.js`) uses `tseslint.configs.recommended`, not type-aware rules.

### Known repo quirks (see also `AGENTS.md`)

- `@prisma/client`/`prisma` are pinned to `5.22.0` in `packages/db` and `apps/api` — keep them in sync when bumping.
- The root `package.json`'s `seed` script and `packages/db`'s prisma `seed` config point at `prisma/seed.mjs`, which doesn't exist — use `pnpm --filter @signa/db seed` (runs `seed.ts` via tsx) instead.
- Each package has its own `.env`; there is no shared root `.env`. `apps/api/.env` holds live credentials and is gitignored.
- No root-level test suite — tests are per-package only, and there's no CI config in this repo to infer conventions from.
