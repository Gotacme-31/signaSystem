export function buildTrackingClipboardText({
  orderNumber,
  trackingUrl,
}: {
  orderNumber: number | string;
  trackingUrl: string;
}) {
  return `Consulta el estado de tu pedido #${String(orderNumber)}:\n${trackingUrl}`;
}

export type TrackingLinkResponse = {
  orderId: unknown;
  trackingUrl: unknown;
};

export type TrackingReadOperation = {
  orderId: number;
  epoch: number;
};

export type TrackingCopyOperation = TrackingReadOperation & {
  copyId: number;
};

export class TrackingAssociationError extends Error {
  constructor() {
    super("No se pudo validar el seguimiento solicitado");
    this.name = "TrackingAssociationError";
  }
}

export function trackingUrlForOrder(requestedOrderId: number, response: unknown) {
  const candidate = response as Partial<TrackingLinkResponse> | null;
  if (
    !candidate
    || candidate.orderId !== requestedOrderId
    || typeof candidate.trackingUrl !== "string"
    || candidate.trackingUrl.length === 0
  ) {
    throw new TrackingAssociationError();
  }

  return candidate.trackingUrl;
}

export class TrackingRequestCoordinator {
  private readonly orderEpochs = new Map<number, number>();
  private readonly regeneratingEpochs = new Map<number, number>();
  private nextCopyId = 0;
  private latestCopy: { copyId: number; orderId: number } | null = null;
  private pendingClipboardWrite: Promise<void> = Promise.resolve();

  beginRead(orderId: number): TrackingReadOperation {
    return { orderId, epoch: this.orderEpochs.get(orderId) ?? 0 };
  }

  beginCopy(orderId: number): TrackingCopyOperation {
    const operation = {
      ...this.beginRead(orderId),
      copyId: ++this.nextCopyId,
    };
    this.latestCopy = { copyId: operation.copyId, orderId };
    return operation;
  }

  beginRegeneration(orderId: number) {
    const epoch = (this.orderEpochs.get(orderId) ?? 0) + 1;
    this.orderEpochs.set(orderId, epoch);
    this.regeneratingEpochs.set(orderId, epoch);

    const invalidatedCopy = this.latestCopy?.orderId === orderId;
    if (invalidatedCopy) this.latestCopy = null;

    return {
      operation: { orderId, epoch } satisfies TrackingReadOperation,
      invalidatedCopy,
    };
  }

  isRegenerating(orderId: number) {
    return this.regeneratingEpochs.has(orderId);
  }

  isCurrent(operation: TrackingReadOperation) {
    return (this.orderEpochs.get(operation.orderId) ?? 0) === operation.epoch;
  }

  isCurrentCopy(operation: TrackingCopyOperation) {
    return this.isCurrent(operation)
      && this.latestCopy?.copyId === operation.copyId
      && this.latestCopy.orderId === operation.orderId;
  }

  finishCopy(operation: TrackingCopyOperation) {
    if (!this.isCurrentCopy(operation)) return false;
    this.latestCopy = null;
    return true;
  }

  finishRegeneration(operation: TrackingReadOperation) {
    if (this.regeneratingEpochs.get(operation.orderId) !== operation.epoch) return false;
    this.regeneratingEpochs.delete(operation.orderId);
    return true;
  }

  waitForClipboardWrites() {
    return this.pendingClipboardWrite;
  }

  async writeClipboard(
    operation: TrackingCopyOperation,
    text: string,
    writeText: (value: string) => Promise<void> | void
  ) {
    await this.pendingClipboardWrite;
    if (!this.isCurrentCopy(operation)) return false;

    const writePromise = Promise.resolve(writeText(text));

    this.pendingClipboardWrite = writePromise.then(
      () => undefined,
      () => undefined
    );
    await writePromise;
    return this.isCurrentCopy(operation);
  }
}

export function currentTrackingUrlForOrder(
  coordinator: TrackingRequestCoordinator,
  operation: TrackingReadOperation,
  response: unknown
) {
  if (!coordinator.isCurrent(operation)) return null;
  return trackingUrlForOrder(operation.orderId, response);
}

export async function copyOrderTracking({
  orderId,
  coordinator,
  requestTracking,
  writeText,
  onStart,
  onTrackingUrl,
  onSuccess,
  onError,
  onFinish,
}: {
  orderId: number;
  coordinator: TrackingRequestCoordinator;
  requestTracking: (orderId: number) => Promise<unknown>;
  writeText?: (text: string) => Promise<void> | void;
  onStart: () => void;
  onTrackingUrl: (trackingUrl: string) => void;
  onSuccess: () => void;
  onError: (kind: "request" | "clipboard", error: unknown) => void;
  onFinish: () => void;
}) {
  const operation = coordinator.beginCopy(orderId);
  let clipboardStep = false;
  onStart();

  try {
    const response = await requestTracking(orderId);
    if (!coordinator.isCurrentCopy(operation)) return;

    const trackingUrl = trackingUrlForOrder(orderId, response);
    onTrackingUrl(trackingUrl);
    clipboardStep = true;

    if (!writeText) throw new Error("Clipboard API unavailable");
    const copied = await coordinator.writeClipboard(
      operation,
      buildTrackingClipboardText({ orderNumber: orderId, trackingUrl }),
      writeText
    );
    if (!copied) return;

    onSuccess();
  } catch (error) {
    if (coordinator.isCurrentCopy(operation)) {
      onError(clipboardStep ? "clipboard" : "request", error);
    }
  } finally {
    if (coordinator.finishCopy(operation)) onFinish();
  }
}
