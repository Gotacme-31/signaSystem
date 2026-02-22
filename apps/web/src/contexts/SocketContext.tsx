// contexts/SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from "react";
import io, { Socket } from "socket.io-client";
import { useAuth } from "../auth/useAuth";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const { user, token } = useAuth();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // Si no hay token o usuario, cerrar conexión existente
    if (!token || !user) {
      if (socketRef.current) {
        socketRef.current.close();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
      return;
    }

    // Si ya hay un socket conectado con el mismo token, no crear uno nuevo
    if (socketRef.current?.connected) {
      return;
    }

    const newSocket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.on("connect", () => {
      setIsConnected(true);
    });

    newSocket.on("disconnect", (reason) => {
      setIsConnected(false);
      
      // Si la desconexión fue por error de autenticación, no reintentar
      if (reason === "io server disconnect" || reason === "transport close") {
        // El servidor cerró la conexión, podría ser token inválido
      }
    });

    newSocket.on("connect_error", (error) => {
      console.error("❌ Error de conexión socket:", error.message);
      setIsConnected(false);
      
      // Si el error es de autenticación, no reintentar
      if (error.message.includes("Authentication error")) {
        newSocket.close();
      }
    });

    newSocket.io.on("reconnect_attempt", (attempt) => {
    });

    newSocket.io.on("reconnect", () => {
    });

    newSocket.io.on("reconnect_error", (error) => {
      console.error("❌ Error de reconexión:", error);
    });

    return () => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.close();
        socketRef.current = null;
        setSocket(null);
        setIsConnected(false);
      }
    };
  }, [token, user]); // Dependencias correctas

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};