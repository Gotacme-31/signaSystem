import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { getToken } from "../auth/storage";

type SocketCtx = {
  socket: Socket | null;
  isConnected: boolean;
};

const SocketContext = createContext<SocketCtx>({ socket: null, isConnected: false });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // ✅ URL del socket (usa tu env o el mismo del API)
  const SOCKET_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    let cancelled = false;

    function makeSocket() {
      const token = getToken();
      if (!token) return null;

      const s = io(SOCKET_URL, {
        transports: ["websocket"],

        // ✅ reconexión infinita
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 4000,
        timeout: 8000,

        // ✅ manda token (en v4 se usa auth)
        auth: { token },
      });

      return s;
    }

    // Si ya hay socket, no recrees sin necesidad
    if (!socketRef.current) {
      const s = makeSocket();
      if (s) socketRef.current = s;
    }

    const s = socketRef.current;

    // Si aún no hay token al montar, reintenta hasta que exista
    const tokenRetry = setInterval(() => {
      if (cancelled) return;
      if (socketRef.current) return; // ya existe

      const token = getToken();
      if (!token) return;

      const newSocket = makeSocket();
      if (!newSocket) return;

      socketRef.current = newSocket;

      // attach listeners
      attachListeners(newSocket);
      newSocket.connect();
    }, 1000);

    function attachListeners(sock: Socket) {
      sock.on("connect", () => {
        setIsConnected(true);
      });

      sock.on("disconnect", () => {
        setIsConnected(false);
      });

      sock.on("connect_error", () => {
        setIsConnected(false);
        // socket.io seguirá reintentando solo por reconnection:true
      });

      sock.io.on("reconnect_attempt", () => {
        // refresca token por si cambió
        const token = getToken();
        sock.auth = { token };
      });
    }

    if (s) attachListeners(s);

    // Si el socket existe pero está desconectado, asegúrate que intente conectarse
    const forceConnect = setInterval(() => {
      if (cancelled) return;
      const sock = socketRef.current;
      const token = getToken();

      if (!sock) return;
      if (!token) return;

      // si auth token cambió, actualízalo
      sock.auth = { token };

      if (!sock.connected && sock.disconnected) {
        sock.connect();
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(tokenRetry);
      clearInterval(forceConnect);

      // OJO: no cierres el socket si quieres que persista al navegar.
      // Si sí quieres cerrarlo al desmontar el provider:
      // socketRef.current?.disconnect();
      // socketRef.current = null;
    };
  }, [SOCKET_URL]);

  const value = useMemo<SocketCtx>(
    () => ({ socket: socketRef.current, isConnected }),
    [isConnected]
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}