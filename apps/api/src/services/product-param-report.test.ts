import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  getProductParamReport,
  ProductParamReportError,
  type ProductParamReportClient,
} from "./product-param-report.service";

const TELA_SUBLIMADA_ID = 1;
const DTF_ID = 2;

const OJILLOS_PARAM = { id: 10, productId: TELA_SUBLIMADA_ID, name: "Ojillos", chargeType: "PER_METER" as const };
const ACABADOS_PARAM = { id: 11, productId: TELA_SUBLIMADA_ID, name: "Acabados", chargeType: "PER_METER" as const };
const TROQUELADO_PARAM = { id: 12, productId: TELA_SUBLIMADA_ID, name: "Troquelado", chargeType: "PER_PIECE" as const };

const CHICO_VARIANT = { id: 20, productId: TELA_SUBLIMADA_ID, name: "Chico" };
const GRANDE_VARIANT = { id: 21, productId: TELA_SUBLIMADA_ID, name: "Grande" };
const DTF_VARIANT = { id: 22, productId: DTF_ID, name: "Único" };
const MEDIANO_VARIANT = { id: 23, productId: TELA_SUBLIMADA_ID, name: "Mediano" };

type FakeOrderItem = {
  id: number;
  productId: number;
  isCustomProduct: boolean;
  quantity: number;
  cancelled: boolean;
  branchId: number;
  createdAt: string;
  optionIds: number[];
  variantId?: number | null;
};

type FakeOrderItemOption = {
  optionId: number;
  quantity: number;
  orderItemId: number;
};

function makeClient(items: FakeOrderItem[], options: FakeOrderItemOption[]): ProductParamReportClient {
  function matchesOrderItemWhere(item: FakeOrderItem, where: any): boolean {
    if (where.productId !== undefined && item.productId !== where.productId) return false;
    if (where.isCustomProduct !== undefined && item.isCustomProduct !== where.isCustomProduct) return false;
    if (where.order) {
      const order = where.order;
      if (order.branchId?.in !== undefined && !order.branchId.in.includes(item.branchId)) return false;
      if (order.OR) {
        const notCancelled = !item.cancelled;
        if (!notCancelled) return false;
      }
      if (order.createdAt) {
        const created = new Date(item.createdAt).getTime();
        if (order.createdAt.gte && created < order.createdAt.gte.getTime()) return false;
        if (order.createdAt.lt && created >= order.createdAt.lt.getTime()) return false;
      }
    }
    if (where.options?.some?.optionId !== undefined) {
      if (!item.optionIds.includes(where.options.some.optionId)) return false;
    }
    if (where.variantId !== undefined) {
      if (item.variantId !== where.variantId) return false;
    }
    return true;
  }

  return {
    product: {
      findUnique: async ({ where }) => {
        if (where.id === TELA_SUBLIMADA_ID) {
          return { id: TELA_SUBLIMADA_ID, name: "Tela Sublimada", unitType: "METER" };
        }
        if (where.id === DTF_ID) {
          return { id: DTF_ID, name: "DTF", unitType: "METER" };
        }
        return null;
      },
    },
    branch: {
      findMany: async ({ where }) => {
        const catalog = [
          { id: 1, name: "Sucursal Centro" },
          { id: 2, name: "Sucursal Norte" },
        ];
        return catalog.filter((branch) => where.id.in.includes(branch.id));
      },
    },
    productParam: {
      findMany: async ({ where }) => {
        const catalog = [OJILLOS_PARAM, ACABADOS_PARAM, TROQUELADO_PARAM];
        return catalog.filter((param) => where.id.in.includes(param.id));
      },
    },
    productVariant: {
      findMany: async ({ where }) => {
        const catalog = [CHICO_VARIANT, GRANDE_VARIANT, DTF_VARIANT, MEDIANO_VARIANT];
        return catalog.filter((variant) => where.id.in.includes(variant.id));
      },
    },
    orderItem: {
      aggregate: async ({ where }) => {
        const matching = items.filter((item) => matchesOrderItemWhere(item, where));
        const sum = matching.reduce((acc, item) => acc + item.quantity, 0);
        return { _sum: { quantity: matching.length > 0 ? (new Prisma.Decimal(sum) as any) : null } };
      },
    },
    orderItemOption: {
      aggregate: async ({ where }) => {
        const matchingItems = items.filter((item) => matchesOrderItemWhere(item, (where as any).orderItem));
        const matchingItemIds = new Set(matchingItems.map((item) => item.id));
        const matching = options.filter(
          (opt) => opt.optionId === (where as any).optionId && matchingItemIds.has(opt.orderItemId)
        );
        const sum = matching.reduce((acc, opt) => acc + opt.quantity, 0);
        return { _sum: { quantity: matching.length > 0 ? (new Prisma.Decimal(sum) as any) : null } };
      },
    },
  };
}

test("total general suma sólo el OrderItem del producto filtrado en un pedido con productos mixtos", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 8, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
    { id: 2, productId: DTF_ID, isCustomProduct: false, quantity: 3, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport({ productId: TELA_SUBLIMADA_ID }, client);

  assert.equal(report.totalQuantity, 8);
});

test("CASO CRÍTICO: tres OrderItem del mismo producto en el mismo pedido, filtrar por parámetro cuenta sólo el item correspondiente", async () => {
  // Mismo pedido (mismo branchId/fecha), tres OrderItem del mismo producto:
  // 5m con Ojillos, 5m sin parámetro, 5m con Acabados.
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [OJILLOS_PARAM.id] },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
    { id: 3, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [ACABADOS_PARAM.id] },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, paramIds: [ACABADOS_PARAM.id] },
    client
  );

  assert.equal(report.totalQuantity, 15, "el total general sí es la suma de los tres items");
  assert.equal(report.byParam.length, 1);
  assert.equal(report.byParam[0].quantity, 5, "el desglose de Acabados debe ser 5, no 15 ni 10");
});

test("un parámetro PER_METER suma OrderItem.quantity, no OrderItemOption.quantity", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 7, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [OJILLOS_PARAM.id] },
  ];
  // OrderItemOption.quantity para PER_METER siempre es 1 en la app real; si el código
  // sumara esto por error, el resultado sería 1 en vez de 7.
  const options: FakeOrderItemOption[] = [{ optionId: OJILLOS_PARAM.id, quantity: 1, orderItemId: 1 }];
  const client = makeClient(items, options);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, paramIds: [OJILLOS_PARAM.id] },
    client
  );

  assert.equal(report.byParam[0].quantity, 7);
});

test("un parámetro PER_PIECE suma OrderItemOption.quantity, no OrderItem.quantity", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 7, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [TROQUELADO_PARAM.id] },
  ];
  // pieceQty capturado en el momento del pedido: 12 piezas de troquelado, aunque
  // el item en metros mida 7.
  const options: FakeOrderItemOption[] = [{ optionId: TROQUELADO_PARAM.id, quantity: 12, orderItemId: 1 }];
  const client = makeClient(items, options);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, paramIds: [TROQUELADO_PARAM.id] },
    client
  );

  assert.equal(report.byParam[0].quantity, 12);
});

test("pedidos cancelados quedan excluidos del total", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 9, cancelled: true, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport({ productId: TELA_SUBLIMADA_ID }, client);

  assert.equal(report.totalQuantity, 5);
});

test("rechaza un paramId que no pertenece al producto filtrado", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () =>
      getProductParamReport(
        { productId: DTF_ID, paramIds: [OJILLOS_PARAM.id] }, // Ojillos pertenece a Tela Sublimada, no a DTF
        client
      ),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "PARAM_PRODUCT_MISMATCH"
  );
});

test("rechaza un paramId inexistente", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () => getProductParamReport({ productId: TELA_SUBLIMADA_ID, paramIds: [9999] }, client),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "PARAM_NOT_FOUND"
  );
});

test("branchLabel es 'Todas las sucursales' sin branchIds, y el nombre real cuando se filtra por una sola", async () => {
  const client = makeClient([], []);

  const withoutBranch = await getProductParamReport({ productId: TELA_SUBLIMADA_ID }, client);
  assert.equal(withoutBranch.branchLabel, "Todas las sucursales");

  const withBranch = await getProductParamReport({ productId: TELA_SUBLIMADA_ID, branchIds: [1] }, client);
  assert.equal(withBranch.branchLabel, "Sucursal Centro");
});

test("producto inexistente lanza PRODUCT_NOT_FOUND", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () => getProductParamReport({ productId: 999 }, client),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "PRODUCT_NOT_FOUND"
  );
});

test("dos sucursales seleccionadas suman ambas, branchLabel indica la cantidad, y una tercera sucursal queda excluida", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 4, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [] },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 6, cancelled: false, branchId: 2, createdAt: "2026-01-01", optionIds: [] },
    { id: 3, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 100, cancelled: false, branchId: 3, createdAt: "2026-01-01", optionIds: [] },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport({ productId: TELA_SUBLIMADA_ID, branchIds: [1, 2] }, client);

  assert.equal(report.totalQuantity, 10, "debe sumar sucursal 1 (4) y sucursal 2 (6), sin la 3 (100)");
  assert.equal(report.branchLabel, "2 sucursales");
});

test("rechaza una sucursal inexistente", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () => getProductParamReport({ productId: TELA_SUBLIMADA_ID, branchIds: [9999] }, client),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "BRANCH_NOT_FOUND"
  );
});

test("rechaza una variante que no pertenece al producto filtrado", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () =>
      getProductParamReport(
        { productId: DTF_ID, variantIds: [CHICO_VARIANT.id] }, // Chico pertenece a Tela Sublimada, no a DTF
        client
      ),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "VARIANT_PRODUCT_MISMATCH"
  );
});

test("rechaza una variante inexistente", async () => {
  const client = makeClient([], []);

  await assert.rejects(
    () => getProductParamReport({ productId: TELA_SUBLIMADA_ID, variantIds: [9999] }, client),
    (error: unknown) => error instanceof ProductParamReportError && error.code === "VARIANT_NOT_FOUND"
  );
});

test("CASO byVariant: un pedido con 2 items del mismo producto en tamaños distintos separa las cantidades correctamente", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 3, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [], variantId: CHICO_VARIANT.id },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 9, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [], variantId: GRANDE_VARIANT.id },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, variantIds: [CHICO_VARIANT.id, GRANDE_VARIANT.id] },
    client
  );

  assert.equal(report.totalQuantity, 12);
  assert.equal(report.byVariant.length, 2);
  const chico = report.byVariant.find((row) => row.variantId === CHICO_VARIANT.id);
  const grande = report.byVariant.find((row) => row.variantId === GRANDE_VARIANT.id);
  assert.equal(chico?.quantity, 3, "Chico debe ser 3, no 12 (el total del pedido)");
  assert.equal(grande?.quantity, 9, "Grande debe ser 9, no 12 (el total del pedido)");
});

test("byParam viene ordenado de mayor a menor cantidad", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [OJILLOS_PARAM.id] },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 20, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [ACABADOS_PARAM.id] },
    { id: 3, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 1, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [TROQUELADO_PARAM.id] },
  ];
  const options: FakeOrderItemOption[] = [{ optionId: TROQUELADO_PARAM.id, quantity: 12, orderItemId: 3 }];
  const client = makeClient(items, options);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, paramIds: [OJILLOS_PARAM.id, ACABADOS_PARAM.id, TROQUELADO_PARAM.id] },
    client
  );

  assert.deepEqual(
    report.byParam.map((row) => row.quantity),
    [20, 12, 5],
    "debe venir 20 (Acabados), 12 (Troquelado), 5 (Ojillos), no en el orden en que se pidieron"
  );
});

test("byVariant viene ordenado de mayor a menor cantidad", async () => {
  const items: FakeOrderItem[] = [
    { id: 1, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 5, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [], variantId: CHICO_VARIANT.id },
    { id: 2, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 20, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [], variantId: GRANDE_VARIANT.id },
    { id: 3, productId: TELA_SUBLIMADA_ID, isCustomProduct: false, quantity: 12, cancelled: false, branchId: 1, createdAt: "2026-01-01", optionIds: [], variantId: MEDIANO_VARIANT.id },
  ];
  const client = makeClient(items, []);

  const report = await getProductParamReport(
    { productId: TELA_SUBLIMADA_ID, variantIds: [CHICO_VARIANT.id, GRANDE_VARIANT.id, MEDIANO_VARIANT.id] },
    client
  );

  assert.deepEqual(
    report.byVariant.map((row) => row.quantity),
    [20, 12, 5],
    "debe venir 20 (Grande), 12 (Mediano), 5 (Chico), no en el orden en que se pidieron"
  );
});
