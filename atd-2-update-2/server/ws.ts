import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

type OutMessage =
  | { type: "booking_created" | "booking_updated"; bookingId: number }
  | { type: "job_assigned"; bookingId: number };

const adminSockets = new Set<WebSocket>();
const driverSocketsByToken = new Map<string, Set<WebSocket>>();

function safeSend(socket: WebSocket, message: OutMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function broadcastToAdmins(message: OutMessage) {
  for (const socket of adminSockets) safeSend(socket, message);
}

export function sendToDriver(token: string, message: OutMessage) {
  const sockets = driverSocketsByToken.get(token);
  if (!sockets) return;
  for (const socket of sockets) safeSend(socket, message);
}

export function attachWebSocketServer(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
    const url = new URL(request.url ?? "", "http://localhost");
    const role = url.searchParams.get("role");
    const token = url.searchParams.get("token");

    if (role === "driver" && token) {
      if (!driverSocketsByToken.has(token)) driverSocketsByToken.set(token, new Set());
      driverSocketsByToken.get(token)!.add(socket);
      socket.on("close", () => driverSocketsByToken.get(token)?.delete(socket));
      return;
    }

    const required = process.env.ACCESS_CODE;
    if (required && url.searchParams.get("code") !== required) {
      socket.close(4401, "Unauthorized");
      return;
    }

    adminSockets.add(socket);
    socket.on("close", () => adminSockets.delete(socket));
  });

  return wss;
}
