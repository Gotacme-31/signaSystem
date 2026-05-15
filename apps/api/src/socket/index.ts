import { Server as SocketServer } from "socket.io";
import { Server as HttpServer } from "http";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "tu-secreto-super-seguro";

export function setupSocket(server: HttpServer) {
  const io = new SocketServer(server, {
    cors: {
      origin: process.env.FRONTEND_URL || "http://localhost:5173",
      credentials: true,
    },
  });

  // Middleware de autenticación
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.data.user = decoded;
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    const accessibleBranchIds = Array.isArray(user.accessibleBranchIds)
      ? user.accessibleBranchIds
      : [];

    const branchIds = new Set<number>();

    // Unirse a sala de sucursal
    if (user.branchId) {
      branchIds.add(user.branchId);
    }

    for (const branchId of accessibleBranchIds) {
      if (Number.isFinite(Number(branchId))) {
        branchIds.add(Number(branchId));
      }
    }

    for (const branchId of branchIds) {
      socket.join(`branch:${branchId}`);
    }

    // Administradores se unen a sala global
    if (user.role === "ADMIN") {
      socket.join("admin");
    }

    // Unirse a sala por rol
    socket.join(`role:${user.role}`);

    socket.on("disconnect", () => {
    });
  });

  return io;
}

export type AppSocket = SocketServer;
