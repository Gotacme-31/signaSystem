// hooks/useSocket.ts
import { useEffect, useRef } from "react";
import { useSocket } from "../contexts/SocketContext";

type EventCallback<T = any> = (data: T) => void;

export const useSocketEvent = <T = any>(event: string, callback?: EventCallback<T>) => {
  const { socket } = useSocket();
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!socket) {
      return;
    }
    const handler = (data: T) => {
      if (callbackRef.current) {
        callbackRef.current(data);
      }
    };

    socket.on(event, handler);

    return () => {
      socket.off(event, handler);
    };
  }, [socket, event]);
};

// Hook específico para pedidos con validación de datos
export const useOrderEvents = (handlers: {
  onOrderCreated?: (order: any) => void;
  onOrderUpdated?: (order: any) => void;
  onOrderDeleted?: (orderId: number) => void;
  onOrderStatusChanged?: (data: { orderId: number; stage: string }) => void;
  onItemStepAdvanced?: (data: { itemId: number; orderId: number; step: number }) => void;
  onOrderDelivered?: (orderId: number) => void;
}) => {
  // Envolver los handlers para validar datos
  const safeHandlers = {
    onOrderCreated: (order: any) => {
      if (order && typeof order === 'object') {
        handlers.onOrderCreated?.(order);
      } else {
        console.warn('Evento order:created recibió datos inválidos:', order);
      }
    },
    onOrderUpdated: (order: any) => {
      if (order && typeof order === 'object') {
        handlers.onOrderUpdated?.(order);
      } else {
        console.warn('Evento order:updated recibió datos inválidos:', order);
      }
    },
    onOrderDeleted: (orderId: any) => {
      if (typeof orderId === 'number') {
        handlers.onOrderDeleted?.(orderId);
      } else {
        console.warn('Evento order:deleted recibió datos inválidos:', orderId);
      }
    },
    onOrderStatusChanged: (data: any) => {
      if (data && typeof data === 'object' && 'orderId' in data && 'stage' in data) {
        handlers.onOrderStatusChanged?.(data);
      } else {
        console.warn('Evento order:statusChanged recibió datos inválidos:', data);
      }
    },
    onItemStepAdvanced: (data: any) => {
      if (data && typeof data === 'object' && 'itemId' in data && 'orderId' in data && 'step' in data) {
        handlers.onItemStepAdvanced?.(data);
      } else {
        console.warn('Evento item:stepAdvanced recibió datos inválidos:', data);
      }
    },
    onOrderDelivered: (orderId: any) => {
      if (typeof orderId === 'number') {
        handlers.onOrderDelivered?.(orderId);
      } else {
        console.warn('Evento order:delivered recibió datos inválidos:', orderId);
      }
    }
  };

  useSocketEvent("order:created", safeHandlers.onOrderCreated);
  useSocketEvent("order:updated", safeHandlers.onOrderUpdated);
  useSocketEvent("order:deleted", safeHandlers.onOrderDeleted);
  useSocketEvent("order:statusChanged", safeHandlers.onOrderStatusChanged);
  useSocketEvent("item:stepAdvanced", safeHandlers.onItemStepAdvanced);
  useSocketEvent("order:delivered", safeHandlers.onOrderDelivered);
};