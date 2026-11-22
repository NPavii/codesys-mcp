import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export interface AppConfig {
  host: string;
  port: number;
  mcpToken: string;
  httpAllowedHosts: string[];
  httpAllowedOrigins: string[];
  httpWriteEnabled: boolean;
  httpEvalEnabled: boolean;
  httpBatchEnabled: boolean;
  httpMaxSessions: number;
  httpSessionTtlMs: number;
  httpRateLimitPerMinute: number;
  officialLookupEnabled: boolean;
  officialLookupTimeoutMs: number;
  officialLookupCacheTtlMs: number;
  externalMaxResponseBytes: number;
  pdfSearchEnabled: boolean;
  pdfDocsDir: string;
  pdfMaxTextChars: number;
  pdfMaxFileBytes: number;
}

function parseIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseStringListEnv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function loadDotEnvFile(): void {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

export function assertHttpConfig(config: AppConfig): void {
  if (config.mcpToken.length < 32) {
    throw new Error("HTTP mode requires MCP_TOKEN with at least 32 characters.");
  }
  if (!isLoopbackHost(config.host) && config.httpAllowedHosts.length === 0) {
    throw new Error("Non-loopback HTTP requires an explicit HTTP_ALLOWED_HOSTS allowlist.");
  }
}

export function loadConfig(): AppConfig {
  loadDotEnvFile();
  return {
    host: process.env.HOST ?? "127.0.0.1",
    port: parseIntegerEnv("PORT", 3000),
    mcpToken: process.env.MCP_TOKEN ?? "",
    httpAllowedHosts: parseStringListEnv("HTTP_ALLOWED_HOSTS"),
    httpAllowedOrigins: parseStringListEnv("HTTP_ALLOWED_ORIGINS"),
    httpWriteEnabled: parseBooleanEnv("HTTP_ENABLE_WRITES", false),
    httpEvalEnabled: parseBooleanEnv("HTTP_ENABLE_EVAL", false),
    httpBatchEnabled: parseBooleanEnv("HTTP_ENABLE_BATCH", false),
    httpMaxSessions: parseIntegerEnv("HTTP_MAX_SESSIONS", 16),
    httpSessionTtlMs: parseIntegerEnv("HTTP_SESSION_TTL_SECONDS", 1800) * 1000,
    httpRateLimitPerMinute: parseIntegerEnv("HTTP_RATE_LIMIT_PER_MINUTE", 120),
    officialLookupEnabled: parseBooleanEnv("OFFICIAL_LOOKUP_ENABLED", true),
    officialLookupTimeoutMs: parseIntegerEnv("OFFICIAL_LOOKUP_TIMEOUT_MS", 3500),
    officialLookupCacheTtlMs: parseIntegerEnv("OFFICIAL_LOOKUP_CACHE_TTL_SECONDS", 3600) * 1000,
    externalMaxResponseBytes: parseIntegerEnv("EXTERNAL_MAX_RESPONSE_BYTES", 2_000_000),
    pdfSearchEnabled: parseBooleanEnv("PDF_SEARCH_ENABLED", true),
    pdfDocsDir: process.env.PDF_DOCS_DIR ?? "docs/pdfs",
    pdfMaxTextChars: parseIntegerEnv("PDF_MAX_TEXT_CHARS", 200000),
    pdfMaxFileBytes: parseIntegerEnv("PDF_MAX_FILE_BYTES", 50_000_000)
  };
}
