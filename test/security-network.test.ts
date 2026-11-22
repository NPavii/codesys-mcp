import { describe, expect, it } from "vitest";
import request from "supertest";
import { assertHttpConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { closeSession, initializeSession, makeTestConfig, mcpPost, TEST_HOST } from "./helpers.js";

describe("synthetic 1: HTTP network boundary", () => {
  it("rejects missing/invalid tokens and untrusted Host/Origin", async () => {
    const app = createApp(makeTestConfig());
    await mcpPost(app, null).send({}).expect(401);
    await mcpPost(app, "short").send({}).expect(401);
    await mcpPost(app).set("Host", "attacker.invalid").send({}).expect(403);
    await mcpPost(app).set("Origin", "https://attacker.invalid").send({}).expect(403);
  });

  it("does not emit wildcard CORS and allows only an exact configured origin", async () => {
    const app = createApp(makeTestConfig({ httpAllowedOrigins: ["https://client.example"] }));
    const denied = await request(app)
      .options("/mcp")
      .set("Host", TEST_HOST)
      .set("Origin", "https://attacker.invalid")
      .set("Access-Control-Request-Method", "POST")
      .expect(403);
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();

    const allowed = await request(app)
      .options("/mcp")
      .set("Host", TEST_HOST)
      .set("Origin", "https://client.example")
      .set("Access-Control-Request-Method", "POST")
      .expect(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://client.example");
    expect(allowed.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("allows an authenticated non-browser MCP session", async () => {
    const app = createApp(makeTestConfig());
    const sessionId = await initializeSession(app);
    expect(sessionId).toBeTruthy();
    await closeSession(app, sessionId);
  });

  it("fails closed for weak tokens and non-loopback without host allowlist", () => {
    expect(() => assertHttpConfig(makeTestConfig({ mcpToken: "short" }))).toThrow();
    expect(() =>
      assertHttpConfig(makeTestConfig({ host: "0.0.0.0", httpAllowedHosts: [] }))
    ).toThrow();
    expect(() =>
      assertHttpConfig(makeTestConfig({ host: "0.0.0.0", httpAllowedHosts: ["mcp.example:3000"] }))
    ).not.toThrow();
  });
});
