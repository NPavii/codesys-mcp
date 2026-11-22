import { createServer } from "node:http";
import { assertHttpConfig, loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig();
assertHttpConfig(config);
const app = createApp(config);
const httpServer = createServer(app);

httpServer.once("error", (err: NodeJS.ErrnoException) => {
  console.error(`HTTP server failed to listen on ${config.host}:${config.port}: ${err.code}`);
  process.exit(1);
});

httpServer.listen(config.port, config.host, () => {
  console.log(`CODESYS MCP server listening on http://${config.host}:${config.port}/mcp`);
});

function shutdown(signal: string): void {
  console.log(`\nReceived ${signal}, shutting down...`);
  httpServer.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
  setTimeout(() => {
    console.log("Forced shutdown after timeout.");
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
