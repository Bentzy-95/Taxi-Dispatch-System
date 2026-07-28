import "dotenv/config";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { appRouter } from "./router";
import { attachWebSocketServer } from "./ws";

const app = express();
app.use(express.json());

app.use(
  "/api/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext: ({ req }) => ({ accessCode: req.headers["x-access-code"] as string | undefined }),
  }),
);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(import.meta.dirname, "..", "dist", "public");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const httpServer = createServer(app);
attachWebSocketServer(httpServer);

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, () => {
  console.log(`Airport transfer dispatch server listening on :${port}`);
});
