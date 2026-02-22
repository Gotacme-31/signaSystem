import { Server as SocketServer } from "socket.io";

// Función para emitir eventos de pedidos
export const orderEvents = (io: SocketServer) => ({
  // Nuevo pedido creado
  orderCreated: (order: any) => {
    // Emitir a la sucursal correspondiente
    io.to(`branch:${order.branchId}`).emit("order:created", order);

    // Si tiene pickup diferente, también emitir allí
    if (order.pickupBranchId && order.pickupBranchId !== order.branchId) {
      io.to(`branch:${order.pickupBranchId}`).emit("order:created", order);
    }

    // Emitir a admin
    io.to("admin").emit("order:created", order);
  },

  // Pedido actualizado
  orderUpdated: (order: any) => {
    io.to(`branch:${order.branchId}`).emit("order:updated", order);
    if (order.pickupBranchId && order.pickupBranchId !== order.branchId) {
      io.to(`branch:${order.pickupBranchId}`).emit("order:updated", order);
    }
    io.to("admin").emit("order:updated", order);
  },

  // Pedido eliminado
  // Pedido eliminado
  orderDeleted: (orderId: number, branchId: number, pickupBranchId?: number) => {

    io.to(`branch:${branchId}`).emit("order:deleted", orderId);
    if (pickupBranchId && pickupBranchId !== branchId) {
      io.to(`branch:${pickupBranchId}`).emit("order:deleted", orderId);
    }
    io.to("admin").emit("order:deleted", orderId);
  },

  // Pedido entregado
  orderDelivered: (orderId: number, branchId: number) => {

    io.to(`branch:${branchId}`).emit("order:delivered", orderId);
    io.to("admin").emit("order:delivered", orderId);
  },
  // Estado de pedido cambiado
  orderStatusChanged: (orderId: number, stage: string, branchId: number) => {

    io.to(`branch:${branchId}`).emit("order:statusChanged", { orderId, stage });
    io.to("admin").emit("order:statusChanged", { orderId, stage });
  },

  // Paso de item avanzado
  itemStepAdvanced: (itemId: number, orderId: number, step: number, branchId: number) => {

    io.to(`branch:${branchId}`).emit("item:stepAdvanced", { itemId, orderId, step });
    io.to("admin").emit("item:stepAdvanced", { itemId, orderId, step });
  },

});