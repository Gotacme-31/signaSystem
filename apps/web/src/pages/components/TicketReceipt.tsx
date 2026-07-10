import {
  formatDateInBusinessTimeZone,
  formatTimeInBusinessTimeZone,
} from "../../lib/businessTime";

export const TICKET_RECEIPT_WIDTH_PX = 320;

type UnitType = "METER" | "PIECE";

type TicketOption = {
  name?: string | null;
};

type TicketItem = {
  id?: number | string;
  quantity?: string | number | null;
  subtotal?: string | number | null;
  isCustomProduct?: boolean;
  customProductName?: string | null;
  customUnitType?: UnitType | null;
  product?: { name?: string | null; unitType?: UnitType | null } | null;
  variantRef?: { name?: string | null } | null;
  options?: TicketOption[] | null;
};

export type TicketReceiptOrder = {
  id?: number | string | null;
  branch?: { name?: string | null } | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  items?: TicketItem[] | null;
  notes?: string | null;
  deliveryDate?: string | null;
  deliveryTime?: string | null;
  estimatedReadyAt?: string | null;
  paymentMethod?: string | null;
  hasIva?: boolean;
  subtotalBeforeTax?: string | number | null;
  ivaAmount?: string | number | null;
  total?: string | number | null;
};

function money(value: string | number | null | undefined) {
  const number = Number(value ?? 0);
  return Number.isNaN(number) ? "0.00" : number.toFixed(2);
}

function formatDate(value: string | Date) {
  return formatDateInBusinessTimeZone(value);
}

function formatTime(value: string | Date) {
  return formatTimeInBusinessTimeZone(value);
}

function formatOrderDelivery(order: Pick<TicketReceiptOrder, "deliveryDate" | "deliveryTime" | "estimatedReadyAt">) {
  if (order.deliveryDate) {
    return `${formatDate(order.deliveryDate)} ${order.deliveryTime ?? (order.estimatedReadyAt ? formatTime(order.estimatedReadyAt) : "")}`.trim();
  }

  return order.estimatedReadyAt ? `${formatDate(order.estimatedReadyAt)} · ${formatTime(order.estimatedReadyAt)}` : "Sin fecha";
}

function itemDisplayName(item: TicketItem) {
  let productName = item.isCustomProduct
    ? item.customProductName ?? "Producto libre"
    : item.product?.name ?? "Desconocido";

  if (!item.isCustomProduct && item.variantRef?.name) {
    productName = `${productName} (${item.variantRef.name})`;
  }

  const params = item.options?.map((option) => option.name).filter(Boolean).join(", ");
  return params ? `${productName} [${params}]` : productName;
}

function itemUnit(item: TicketItem) {
  const unitType = item.isCustomProduct ? item.customUnitType : item.product?.unitType;
  return unitType === "METER" ? "m" : "pza";
}

export default function TicketReceipt({
  order,
  generatedAt,
}: {
  order: TicketReceiptOrder;
  generatedAt: Date;
}) {
  const items = order.items ?? [];
  const total = order.total ?? items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);

  return (
    <div
      className="bg-white p-6 font-mono text-sm leading-snug text-black"
      style={{ width: TICKET_RECEIPT_WIDTH_PX, minWidth: TICKET_RECEIPT_WIDTH_PX }}
    >
      <div className="mb-1 text-center text-base font-bold">
        {order.branch?.name ?? "SIGNA SUBLIMACION"}
      </div>

      <div className="mb-3 border-b border-dashed border-gray-400 pb-3 text-center">
        <div className="mb-1">Fecha: {formatDate(generatedAt)}, {formatTime(generatedAt)}</div>
        <div className="font-semibold">Nombre: {order.customer?.name ?? "—"}</div>
        <div>{order.customer?.phone ?? "—"}</div>
      </div>

      <div className="mb-4">
        <div className="mb-2 text-base font-bold">Productos</div>
        {items.length === 0 ? (
          <div className="mb-1">• (Sin productos)</div>
        ) : (
          items.map((item, index) => (
            <div key={item.id ?? index} className="mb-1 break-words">
              • {itemDisplayName(item)} — {item.quantity ?? "0"} {itemUnit(item)}
            </div>
          ))
        )}
      </div>

      {order.notes && (
        <div className="mb-4 border-t border-dashed border-gray-400 pt-3">
          <div className="mb-1 whitespace-pre-wrap break-words">
            <span className="font-semibold">Notas:</span> {order.notes}
          </div>
        </div>
      )}

      <div className="mb-4 border-t border-dashed border-gray-400 pt-3">
        <div className="mb-1"><span className="font-semibold">Entrega:</span> {formatOrderDelivery(order)}</div>
        <div className="mb-1"><span className="font-semibold">Forma de pago:</span> {order.paymentMethod ?? "—"}</div>
      </div>

      <div className="mb-6 border-t border-dashed border-gray-400 pt-3">
        {order.hasIva && (
          <>
            <div className="mb-1 flex justify-between text-sm">
              <span>Subtotal:</span>
              <span>${money(order.subtotalBeforeTax)}</span>
            </div>
            <div className="mb-2 flex justify-between text-sm">
              <span>IVA:</span>
              <span>+${money(order.ivaAmount)}</span>
            </div>
          </>
        )}

        <div className="text-center text-xl font-bold">
          TOTAL: ${money(total)}
        </div>
      </div>

      <div className="border-t border-dashed border-gray-400 pt-4 text-center text-xs">
        <div className="mb-1">---</div>
        <div>REVISA TU MATERIAL A LA ENTREGA, SALIDA LA MERCANCIA</div>
        <div>NO HAY CAMBIOS NI DEVOLUCIONES AL SOLICITAR EL TRABAJO</div>
        <div>ACEPTAS LOS TERMINOS Y CONDICIONES DE LOS SERVICIOS,</div>
        <div>PUEDES CONSULTARLOS EN www.signasublimacion.com</div>
        <div className="mt-2 font-bold">GRACIAS POR TU COMPRA</div>
      </div>
    </div>
  );
}
