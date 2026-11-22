import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server.js";
import {
  closeSession,
  initializeSession,
  listToolNames,
  makeTestConfig,
  mcpPost,
  TEST_HOST,
  TEST_TOKEN
} from "./helpers.js";

describe("HTTP server", () => {
  it("serves health without exposing bridge data", async () => {
    const response = await request(createApp(makeTestConfig())).get("/healthz").expect(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.name).toBe("codesys-mcp");
    expect(response.body).not.toHaveProperty("mcpToken");
  });

  it("requires authentication and supports the complete explicitly enabled toolset", async () => {
    const app = createApp(
      makeTestConfig({ httpWriteEnabled: true, httpEvalEnabled: true, httpBatchEnabled: true })
    );
    await mcpPost(app, null).send({}).expect(401);

    const sessionId = await initializeSession(app);
    const toolNames = await listToolNames(app, sessionId);
    expect(toolNames).toEqual(
      expect.arrayContaining([
        "search_codesys_docs",
        "codesys_project_open",
        "codesys_set_code",
        "codesys_eval",
        "codesys_batch",
        "codesys_online_write",
        "codesys_download_application",
        "codesys_application_start_stop",
        "codesys_create_project"
      ])
    );

    const toolCallResponse = await mcpPost(app)
      .set("mcp-session-id", sessionId)
      .send({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "search_codesys_docs",
          arguments: { query: "TON timer Structured Text", limit: 2, sourceMode: "curated" }
        }
      })
      .expect(200);
    expect(toolCallResponse.body.result.content[0].text).toContain("TON timer");
    await closeSession(app, sessionId);
  });

  it("uses constant request authentication metadata", async () => {
    const app = createApp(makeTestConfig());
    const response = await mcpPost(app, "invalid-invalid-invalid-invalid-invalid")
      .set("Host", TEST_HOST)
      .send({});
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
    expect(TEST_TOKEN).toHaveLength(32);
  });
});
