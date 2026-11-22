import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";
import type { AppConfig } from "../src/config.js";

export const TEST_TOKEN = "0123456789abcdef0123456789abcdef";
export const TEST_HOST = "localhost:3000";

export function makeTestConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 3000,
    mcpToken: TEST_TOKEN,
    httpAllowedHosts: [],
    httpAllowedOrigins: [],
    httpWriteEnabled: false,
    httpEvalEnabled: false,
    httpBatchEnabled: false,
    httpMaxSessions: 16,
    httpSessionTtlMs: 1_800_000,
    httpRateLimitPerMinute: 120,
    officialLookupEnabled: false,
    officialLookupTimeoutMs: 100,
    officialLookupCacheTtlMs: 1000,
    externalMaxResponseBytes: 2_000_000,
    pdfSearchEnabled: false,
    pdfDocsDir: "docs/pdfs",
    pdfMaxTextChars: 200000,
    pdfMaxFileBytes: 50_000_000,
    ...overrides
  };
}

export function mcpPost(app: Express, token: string | null = TEST_TOKEN) {
  let builder = request(app)
    .post("/mcp")
    .set("Host", TEST_HOST)
    .set("Accept", "application/json, text/event-stream");
  if (token) builder = builder.set("Authorization", `Bearer ${token}`);
  return builder;
}

export async function initializeSession(app: Express, token?: string): Promise<string> {
  const response = await mcpPost(app, token)
    .send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" }
      }
    })
    .expect(200);
  const sessionId = response.header["mcp-session-id"];
  expect(sessionId).toBeTruthy();
  await mcpPost(app, token)
    .set("mcp-session-id", sessionId)
    .send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })
    .expect((result) => {
      expect([200, 202]).toContain(result.status);
    });
  return sessionId;
}

export async function listToolNames(app: Express, sessionId: string): Promise<string[]> {
  const response = await mcpPost(app)
    .set("mcp-session-id", sessionId)
    .send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
    .expect(200);
  return response.body.result.tools.map((tool: { name: string }) => tool.name);
}

export async function closeSession(app: Express, sessionId: string): Promise<void> {
  await request(app)
    .delete("/mcp")
    .set("Host", TEST_HOST)
    .set("Authorization", `Bearer ${TEST_TOKEN}`)
    .set("mcp-session-id", sessionId);
}
