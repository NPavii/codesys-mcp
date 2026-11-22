import { describe, expect, it } from "vitest";
import { assertBatchStepsAllowed, makeToolPolicy } from "../src/mcp/policy.js";
import { createApp } from "../src/server.js";
import { closeSession, initializeSession, listToolNames, makeTestConfig } from "./helpers.js";

const dangerous = [
  "codesys_eval",
  "codesys_batch",
  "codesys_create_pou",
  "codesys_set_code",
  "codesys_online_write",
  "codesys_download_application",
  "codesys_device_user_add",
  "codesys_snapshot_restore"
];

describe("synthetic 2: dangerous tool policy", () => {
  it("is read-only over HTTP by default", async () => {
    const app = createApp(makeTestConfig());
    const sessionId = await initializeSession(app);
    const names = await listToolNames(app, sessionId);
    for (const name of dangerous) expect(names).not.toContain(name);
    expect(names).toContain("codesys_project_open");
    expect(names).toContain("codesys_list_objects");
    expect(names).toContain("codesys_online_read");
    await closeSession(app, sessionId);
  });

  it("keeps eval and batch disabled when writes are explicitly enabled", async () => {
    const app = createApp(makeTestConfig({ httpWriteEnabled: true }));
    const sessionId = await initializeSession(app);
    const names = await listToolNames(app, sessionId);
    expect(names).toContain("codesys_create_pou");
    expect(names).toContain("codesys_online_write");
    expect(names).not.toContain("codesys_eval");
    expect(names).not.toContain("codesys_batch");
    await closeSession(app, sessionId);
  });

  it("blocks eval, nested batch and writes inside HTTP batch", () => {
    const readOnly = makeToolPolicy(makeTestConfig(), "http");
    expect(() => assertBatchStepsAllowed([{ op: "eval", args: { expr: "1" } }], readOnly)).toThrow(
      /eval/
    );
    expect(() => assertBatchStepsAllowed([{ op: "batch" }], readOnly)).toThrow(/Nested/);
    expect(() => assertBatchStepsAllowed([{ op: "online_write" }], readOnly)).toThrow(/read-only/);
    expect(() => assertBatchStepsAllowed([{ op: "list_objects" }], readOnly)).not.toThrow();

    const stdio = makeToolPolicy(makeTestConfig(), "stdio");
    expect(() => assertBatchStepsAllowed([{ op: "online_write" }], stdio)).not.toThrow();
  });
});
