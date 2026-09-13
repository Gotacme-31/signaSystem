import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrackingClipboardText,
  copyOrderTracking,
  currentTrackingUrlForOrder,
  TrackingAssociationError,
  TrackingRequestCoordinator,
} from "./trackingClipboard";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function createCopyHarness() {
  const coordinator = new TrackingRequestCoordinator();
  const state: {
    clipboard: string;
    loading: number | null;
    cache: Map<number, string>;
    successes: number[];
    errors: Array<{ orderId: number; kind: "request" | "clipboard"; error: unknown }>;
  } = {
    clipboard: "",
    loading: null,
    cache: new Map(),
    successes: [],
    errors: [],
  };

  const run = (
    orderId: number,
    response: Promise<unknown>,
    writeText: (text: string) => Promise<void> | void = async (text) => {
      state.clipboard = text;
    }
  ) => copyOrderTracking({
    orderId,
    coordinator,
    requestTracking: () => response,
    writeText,
    onStart: () => { state.loading = orderId; },
    onTrackingUrl: (trackingUrl) => { state.cache.set(orderId, trackingUrl); },
    onSuccess: () => { state.successes.push(orderId); },
    onError: (kind, error) => { state.errors.push({ orderId, kind, error }); },
    onFinish: () => {
      if (state.loading === orderId) state.loading = null;
    },
  });

  return { coordinator, state, run };
}

test("tracking clipboard text keeps the order number and URL on separate lines", () => {
  assert.equal(
    buildTrackingClipboardText({
      orderNumber: 31275,
      trackingUrl: "https://signa-system.vercel.app/track/abc123",
    }),
    "Consulta el estado de tu pedido #31275:\nhttps://signa-system.vercel.app/track/abc123"
  );
});

test("tracking clipboard text contains no customer or commercial data", () => {
  const text = buildTrackingClipboardText({ orderNumber: 31275, trackingUrl: "https://signa.example/track/token" });
  assert.doesNotMatch(text, /customer|phone|email|address|notes|subtotal|total|payment|product/i);
});

test("copy tracking keeps each explicit order associated after adding a newer order", async () => {
  const { state, run } = createCopyHarness();
  const urls = new Map([
    [100, "https://signa.example/track/token-a"],
    [101, "https://signa.example/track/token-b"],
    [102, "https://signa.example/track/token-c"],
  ]);
  const requestedIds: number[] = [];
  const responseFor = (orderId: number) => {
    requestedIds.push(orderId);
    return Promise.resolve({ orderId, trackingUrl: urls.get(orderId)! });
  };

  await run(100, responseFor(100));
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");

  await run(101, responseFor(101));
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #101:\nhttps://signa.example/track/token-b");

  await run(100, responseFor(100));
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");

  const orders = [102, 101, 100];
  assert.equal(orders[0], 102);
  await run(100, responseFor(100));
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");
  assert.deepEqual(requestedIds, [100, 101, 100, 100]);
});

test("latest copy intent wins when the older request resolves last", async () => {
  const { state, run } = createCopyHarness();
  const responseC = deferred<{ orderId: number; trackingUrl: string }>();
  const responseA = deferred<{ orderId: number; trackingUrl: string }>();

  const copyC = run(102, responseC.promise);
  const copyA = run(100, responseA.promise);
  responseA.resolve({ orderId: 100, trackingUrl: "https://signa.example/track/token-a" });
  await copyA;
  responseC.resolve({ orderId: 102, trackingUrl: "https://signa.example/track/token-c" });
  await copyC;

  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");
  assert.deepEqual(state.successes, [100]);
  assert.equal(state.loading, null);
});

test("latest copy intent wins when the older request resolves first", async () => {
  const { state, run } = createCopyHarness();
  const responseC = deferred<{ orderId: number; trackingUrl: string }>();
  const responseA = deferred<{ orderId: number; trackingUrl: string }>();

  const copyC = run(102, responseC.promise);
  const copyA = run(100, responseA.promise);
  responseC.resolve({ orderId: 102, trackingUrl: "https://signa.example/track/token-c" });
  await copyC;
  assert.equal(state.clipboard, "");

  responseA.resolve({ orderId: 100, trackingUrl: "https://signa.example/track/token-a" });
  await copyA;
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");
  assert.deepEqual(state.successes, [100]);
});

test("a newer copy waits for an older clipboard write and remains final", async () => {
  const { state, run } = createCopyHarness();
  const oldWriteStarted = deferred<void>();
  const releaseOldWrite = deferred<void>();
  const copyC = run(
    102,
    Promise.resolve({ orderId: 102, trackingUrl: "https://signa.example/track/token-c" }),
    async (text) => {
      oldWriteStarted.resolve(undefined);
      await releaseOldWrite.promise;
      state.clipboard = text;
    }
  );
  await oldWriteStarted.promise;

  const copyA = run(
    100,
    Promise.resolve({ orderId: 100, trackingUrl: "https://signa.example/track/token-a" })
  );
  releaseOldWrite.resolve(undefined);
  await Promise.all([copyC, copyA]);

  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");
  assert.deepEqual(state.successes, [100]);
});

test("regeneration waits for an already-started clipboard write", async () => {
  const coordinator = new TrackingRequestCoordinator();
  const copy = coordinator.beginCopy(100);
  const writeStarted = deferred<void>();
  const releaseWrite = deferred<void>();
  const write = coordinator.writeClipboard(copy, "old URL", async () => {
    writeStarted.resolve(undefined);
    await releaseWrite.promise;
  });
  await writeStarted.promise;

  const { operation: regeneration } = coordinator.beginRegeneration(100);
  let regenerationMayContinue = false;
  const waitForWrite = coordinator.waitForClipboardWrites().then(() => {
    regenerationMayContinue = true;
  });
  await Promise.resolve();
  assert.equal(regenerationMayContinue, false);

  releaseWrite.resolve(undefined);
  await Promise.all([write, waitForWrite]);
  assert.equal(regenerationMayContinue, true);
  assert.equal(coordinator.isCurrent(regeneration), true);
  assert.equal(coordinator.finishCopy(copy), false);
});

test("a mismatched response cannot update cache, clipboard, or success state", async () => {
  const { state, run } = createCopyHarness();
  state.clipboard = "tracking anterior de #102";

  await run(100, Promise.resolve({
    orderId: 101,
    trackingUrl: "https://signa.example/track/token-b",
  }));

  assert.equal(state.clipboard, "tracking anterior de #102");
  assert.equal(state.cache.has(100), false);
  assert.deepEqual(state.successes, []);
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0].kind, "request");
  assert.ok(state.errors[0].error instanceof TrackingAssociationError);
  assert.equal(state.loading, null);
});

test("a response without orderId is rejected before any side effect", async () => {
  const { state, run } = createCopyHarness();

  await run(100, Promise.resolve({
    trackingUrl: "https://signa.example/track/token-a",
  }));

  assert.equal(state.cache.size, 0);
  assert.equal(state.clipboard, "");
  assert.deepEqual(state.successes, []);
  assert.equal(state.errors[0].kind, "request");
  assert.ok(state.errors[0].error instanceof TrackingAssociationError);
});

test("clipboard failure reports failure and permits a successful retry", async () => {
  const { state, run } = createCopyHarness();
  const response = { orderId: 100, trackingUrl: "https://signa.example/track/token-a" };
  state.clipboard = "tracking anterior de #102";

  await run(100, Promise.resolve(response), async () => {
    throw new Error("NotAllowedError");
  });

  assert.equal(state.clipboard, "tracking anterior de #102");
  assert.deepEqual(state.successes, []);
  assert.equal(state.errors.length, 1);
  assert.equal(state.errors[0].kind, "clipboard");
  assert.equal(state.loading, null);

  await run(100, Promise.resolve(response));
  assert.equal(state.clipboard, "Consulta el estado de tu pedido #100:\nhttps://signa.example/track/token-a");
  assert.deepEqual(state.successes, [100]);
});

test("a GET started before regeneration cannot restore the old URL", async () => {
  const coordinator = new TrackingRequestCoordinator();
  const cache = new Map<number, string>();
  const oldGet = deferred<{ orderId: number; trackingUrl: string }>();
  const oldOperation = coordinator.beginRead(100);
  const oldResult = oldGet.promise.then((response) => {
    const trackingUrl = currentTrackingUrlForOrder(coordinator, oldOperation, response);
    if (trackingUrl) cache.set(100, trackingUrl);
  });

  const { operation: regeneration } = coordinator.beginRegeneration(100);
  const newUrl = currentTrackingUrlForOrder(coordinator, regeneration, {
    orderId: 100,
    trackingUrl: "https://signa.example/track/token-new",
  });
  assert.ok(newUrl);
  cache.set(100, newUrl);
  coordinator.finishRegeneration(regeneration);

  oldGet.resolve({ orderId: 100, trackingUrl: "https://signa.example/track/token-old" });
  await oldResult;

  assert.equal(cache.get(100), "https://signa.example/track/token-new");
});

test("regenerating one order does not invalidate a copy for another order", async () => {
  const { coordinator, state, run } = createCopyHarness();
  const responseB = deferred<{ orderId: number; trackingUrl: string }>();
  const copyB = run(101, responseB.promise);
  const { operation: regenerationA } = coordinator.beginRegeneration(100);

  responseB.resolve({ orderId: 101, trackingUrl: "https://signa.example/track/token-b" });
  await copyB;
  coordinator.finishRegeneration(regenerationA);

  assert.equal(state.clipboard, "Consulta el estado de tu pedido #101:\nhttps://signa.example/track/token-b");
  assert.deepEqual(state.successes, [101]);
});
