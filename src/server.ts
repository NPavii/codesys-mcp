import { randomUUID, timingSafeEqual } from "node:crypto";
import express, { type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AppConfig } from "./config.js";
import { createCodesysMcpServer } from "./mcp/tools.js";

interface Session {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

interface RateBucket {
  windowStart: number;
  count: number;
}

function sendMcpError(res: Response, status: number, message: string): void {
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32000, message },
    id: null
  });
}

function isAuthorized(req: Request, token: string): boolean {
  const actual = Buffer.from(req.header("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function localHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

export function createApp(config: AppConfig) {
  const app = express();
  const transports = new Map<string, Session>();
  const rateBuckets = new Map<string, RateBucket>();
  const allowedHosts = new Set(
    (config.httpAllowedHosts.length > 0 ? config.httpAllowedHosts : localHosts(config.port)).map(
      (host) => host.toLowerCase()
    )
  );
  const allowedOrigins = new Set(config.httpAllowedOrigins);

  app.disable("x-powered-by");

  app.use("/mcp", (req, res, next) => {
    const host = (req.headers.host ?? "").toLowerCase();
    if (!allowedHosts.has(host)) {
      sendMcpError(res, 403, "Forbidden host.");
      return;
    }

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      sendMcpError(res, 403, "Forbidden origin.");
      return;
    }
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, mcp-session-id, mcp-protocol-version, last-event-id"
      );
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    }
    if (req.method === "OPTIONS") {
      if (!origin) {
        sendMcpError(res, 403, "CORS preflight requires an allowed Origin.");
        return;
      }
      res.status(204).end();
      return;
    }
    next();
  });

  app.use("/mcp", (req, res, next) => {
    const requestId = randomUUID();
    res.on("finish", () => {
      const body = req.body as { method?: string; params?: { name?: string } } | undefined;
      console.info(
        JSON.stringify({
          event: "mcp_request",
          requestId,
          method: body?.method,
          tool: body?.method === "tools/call" ? body.params?.name : undefined,
          remote: req.socket.remoteAddress,
          status: res.statusCode,
          at: new Date().toISOString()
        })
      );
    });
    next();
  });

  app.use("/mcp", (req, res, next) => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
      if (now - bucket.windowStart >= 60_000) rateBuckets.delete(key);
    }
    const key = req.socket.remoteAddress ?? "unknown";
    const bucket = rateBuckets.get(key) ?? { windowStart: now, count: 0 };
    bucket.count++;
    rateBuckets.set(key, bucket);
    if (bucket.count > config.httpRateLimitPerMinute) {
      sendMcpError(res, 429, "Too many requests.");
      return;
    }
    next();
  });

  app.use("/mcp", (req, res, next) => {
    if (config.mcpToken.length < 32) {
      sendMcpError(res, 503, "HTTP mode requires a strong MCP_TOKEN.");
      return;
    }
    if (!isAuthorized(req, config.mcpToken)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      sendMcpError(res, 401, "Unauthorized.");
      return;
    }
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      name: "codesys-mcp",
      version: "0.4.0",
      officialLookupEnabled: config.officialLookupEnabled
    });
  });

  function sweepSessions(): void {
    const now = Date.now();
    for (const [id, session] of transports) {
      if (now - session.lastSeen > config.httpSessionTtlMs) {
        transports.delete(id);
        void session.transport.close();
      }
    }
  }

  function getSession(sessionId: string | undefined): Session | undefined {
    const session = sessionId ? transports.get(sessionId) : undefined;
    if (session) session.lastSeen = Date.now();
    return session;
  }

  app.post("/mcp", async (req: Request, res: Response) => {
    sweepSessions();
    const sessionId = req.header("mcp-session-id");
    let session = getSession(sessionId);
    let transport = session?.transport;

    try {
      if (!transport && !sessionId && isInitializeRequest(req.body)) {
        if (transports.size >= config.httpMaxSessions) {
          sendMcpError(res, 429, "Too many active MCP sessions.");
          return;
        }
        transport = new StreamableHTTPServerTransport({
          enableJsonResponse: true,
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (newSessionId) => {
            if (transport) transports.set(newSessionId, { transport, lastSeen: Date.now() });
          }
        });
        const newTransport = transport;
        newTransport.onclose = () => {
          const closedId = newTransport.sessionId;
          if (closedId) transports.delete(closedId);
        };
        const mcpServer = createCodesysMcpServer(config, "http");
        await mcpServer.connect(newTransport);
        session = { transport: newTransport, lastSeen: Date.now() };
      } else if (!transport) {
        sendMcpError(res, 400, "Bad Request: missing initialize request or valid mcp-session-id.");
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        const requestId = randomUUID();
        console.error(JSON.stringify({ event: "mcp_internal_error", requestId }));
        sendMcpError(res, 500, `Internal MCP server error. Request ID: ${requestId}`);
      }
    }
  });

  app.get("/mcp", async (req, res) => {
    sweepSessions();
    const session = getSession(req.header("mcp-session-id"));
    if (!session) {
      sendMcpError(res, 400, "Bad Request: invalid or missing mcp-session-id.");
      return;
    }
    try {
      await session.transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) sendMcpError(res, 500, "Internal MCP server error.");
    }
  });

  app.delete("/mcp", async (req, res) => {
    sweepSessions();
    const session = getSession(req.header("mcp-session-id"));
    if (!session) {
      sendMcpError(res, 400, "Bad Request: invalid or missing mcp-session-id.");
      return;
    }
    try {
      await session.transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) sendMcpError(res, 500, "Internal MCP server error.");
    }
  });

  return app;
}
