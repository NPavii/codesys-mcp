import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readTextLimited } from "../src/knowledge/httpLimits.js";
import { cleanupColdArtifacts, createColdArtifacts, writeColdTask } from "../src/mcp/artifacts.js";
import { createApp } from "../src/server.js";
import { closeSession, initializeSession, makeTestConfig, mcpPost } from "./helpers.js";

describe("synthetic 3: resource and secret protection", () => {
  it("enforces the MCP session cap", async () => {
    const app = createApp(makeTestConfig({ httpMaxSessions: 2 }));
    const first = await initializeSession(app);
    const second = await initializeSession(app);
    await mcpPost(app)
      .send({
        jsonrpc: "2.0",
        id: 99,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "overflow", version: "1" }
        }
      })
      .expect(429);
    await closeSession(app, first);
    await closeSession(app, second);
  });

  it("enforces request rate limits before authentication", async () => {
    const app = createApp(makeTestConfig({ httpRateLimitPerMinute: 3 }));
    await mcpPost(app, null).send({}).expect(401);
    await mcpPost(app, null).send({}).expect(401);
    await mcpPost(app, null).send({}).expect(401);
    await mcpPost(app, null).send({}).expect(429);
  });

  it("uses unique cold artifacts and removes secret-bearing files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "codesys-artifacts-"));
    try {
      const first = createColdArtifacts(directory);
      const second = createColdArtifacts(directory);
      expect(first.taskFile).not.toBe(second.taskFile);
      writeColdTask(first, { op: "device_user_add", args: { password: "synthetic-secret" } });
      await writeFile(first.resultFile, "result", "utf8");
      await writeFile(first.cmdFile, "cmd", "utf8");
      cleanupColdArtifacts(first);
      for (const file of Object.values(first)) expect(existsSync(file)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("limits streamed response bodies", async () => {
    expect(await readTextLimited(new Response("abcdef"), 6)).toBe("abcdef");
    await expect(readTextLimited(new Response("abcdef"), 3)).rejects.toThrow(/exceeds/);
  });
});
