import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupColdArtifacts, createColdArtifacts, writeColdTask } from "./artifacts.js";

export interface BridgeConfig {
  codesysExe: string;
  codesysProfile: string;
  bridgeDir: string;
  timeoutMs: number;
  maxQueue: number;
}

export interface BridgeTask {
  op: string;
  args: Record<string, unknown>;
}

export interface BridgeResult {
  ok: boolean;
  error: string | null;
  data: unknown;
}

const DEFAULT_PROFILE = "CODESYS V3.5 SP21 Patch 1";
const EXE_SEARCH_ROOTS = ["C:\\Program Files\\CODESYS", "C:\\Program Files (x86)\\CODESYS"];

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function findCodesysExe(dir: string, depth: number): string | null {
  if (depth > 3) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const candidate = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = findCodesysExe(candidate, depth + 1);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === "codesys.exe") {
      return candidate;
    }
  }
  return null;
}

function resolveCodesysExe(): string {
  if (process.env.CODESYS_EXE) return process.env.CODESYS_EXE;
  for (const root of EXE_SEARCH_ROOTS) {
    const hit = findCodesysExe(root, 0);
    if (hit) return hit;
  }
  return "";
}

function moduleRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

export function loadBridgeConfig(): BridgeConfig {
  const root = moduleRoot();
  return {
    codesysExe: resolveCodesysExe(),
    codesysProfile: process.env.CODESYS_PROFILE ?? DEFAULT_PROFILE,
    bridgeDir: process.env.CODESYS_BRIDGE_DIR ?? path.join(root, "bridge"),
    timeoutMs: positiveInteger(process.env.CODESYS_BRIDGE_TIMEOUT_MS, 240000),
    maxQueue: positiveInteger(process.env.CODESYS_BRIDGE_MAX_QUEUE, 32)
  };
}

let queue: Promise<unknown> = Promise.resolve();
let pendingTasks = 0;

export function runBridgeTaskSerial(task: BridgeTask): Promise<BridgeResult> {
  const config = loadBridgeConfig();
  if (pendingTasks >= config.maxQueue) {
    return Promise.reject(new Error("CODESYS bridge queue is full."));
  }
  pendingTasks++;
  const run = queue
    .then(() => runBridgeTask(task, config))
    .finally(() => {
      pendingTasks--;
    });
  queue = run.catch(() => undefined);
  return run;
}

function daemonPingPath(): string {
  return path.join(loadBridgeConfig().bridgeDir, "daemon_ping.json");
}

function queueDir(): string {
  if (process.env.CB_QUEUE_DIR) return process.env.CB_QUEUE_DIR;
  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "CodeSYS-MCP", "queue");
  }
  return path.join(loadBridgeConfig().bridgeDir, "queue");
}

export function daemonAlive(maxAgeMs = 5000): boolean {
  try {
    const ping = JSON.parse(readFileSync(daemonPingPath(), "utf8")) as {
      ts?: number;
      status?: string;
    };
    return (
      typeof ping.ts === "number" &&
      ping.status !== "stopped" &&
      Date.now() / 1000 - ping.ts < maxAgeMs / 1000
    );
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDaemonStarted(config: BridgeConfig): Promise<void> {
  try {
    const daemonPy = path.join(config.bridgeDir, "bridge_daemon.py");
    if (!existsSync(daemonPy)) return;
    if (config.codesysExe) {
      const cmdFile = path.join(config.bridgeDir, "bridge_daemon_run.cmd");
      writeFileSync(
        cmdFile,
        [
          "@echo off",
          `"${config.codesysExe}" --noUI --profile="${config.codesysProfile}" --runscript="${daemonPy}"`,
          ""
        ].join("\r\n"),
        { encoding: "utf8", mode: 0o600 }
      );
      const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", cmdFile], {
        windowsHide: true,
        detached: true
      });
      child.unref();
    } else {
      // Non-standard installations are configured in bridge_daemon.local.ps1.
      const launcher = path.join(config.bridgeDir, "bridge_daemon.cmd");
      if (!existsSync(launcher)) return;
      const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", launcher], {
        windowsHide: true,
        detached: true,
        env: { ...process.env, CB_MONITOR: process.env.CB_MONITOR ?? "0", CB_KEEP: "1" }
      });
      child.unref();
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < 120000) {
      if (daemonAlive(10000)) return;
      await sleep(1000);
    }
  } catch {
    // Cold fallback reports a useful error if CODESYS is unavailable.
  }
}

async function runBridgeTaskViaDaemon(task: BridgeTask, timeoutMs: number): Promise<BridgeResult> {
  const directory = queueDir();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const id = `mcp-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const taskPath = path.join(directory, `${id}.json`);
  const temporaryTaskPath = `${taskPath}.tmp`;
  const resultPath = path.join(directory, `${id}.result.json`);
  writeFileSync(temporaryTaskPath, JSON.stringify(task), { encoding: "utf8", mode: 0o600 });
  renameSync(temporaryTaskPath, taskPath);
  const startedAt = Date.now();
  try {
    while (Date.now() - startedAt < timeoutMs) {
      if (existsSync(resultPath)) {
        await sleep(50);
        return JSON.parse(readFileSync(resultPath, "utf8")) as BridgeResult;
      }
      await sleep(150);
    }
    throw new Error(`Warm daemon did not answer within ${timeoutMs} ms.`);
  } finally {
    rmSync(temporaryTaskPath, { force: true });
    rmSync(taskPath, { force: true });
    rmSync(resultPath, { force: true });
  }
}

export async function runBridgeTask(
  task: BridgeTask,
  suppliedConfig?: BridgeConfig
): Promise<BridgeResult> {
  const config = suppliedConfig ?? loadBridgeConfig();
  if (!daemonAlive() && process.env.CODESYS_BRIDGE_AUTOSTART !== "0") {
    await ensureDaemonStarted(config);
  }
  if (daemonAlive()) {
    try {
      const result = await runBridgeTaskViaDaemon(task, config.timeoutMs);
      if (result && typeof result === "object" && "ok" in result) return result;
    } catch (err) {
      if (daemonAlive(15000)) {
        throw new Error(
          `Warm daemon accepted the task but did not answer (${(err as Error).message}). ` +
            "Wait and retry, or stop it with 'python bridge_client.py stop'.",
          { cause: err }
        );
      }
    }
  }
  return runBridgeTaskCold(task, config);
}

async function runBridgeTaskCold(task: BridgeTask, config: BridgeConfig): Promise<BridgeResult> {
  if (!config.codesysExe) {
    return {
      ok: false,
      error: "CODESYS.exe not found. Set CODESYS_EXE to the full path of CODESYS.exe.",
      data: null
    };
  }
  const bridgePy = path.join(config.bridgeDir, "bridge.py");
  if (!existsSync(bridgePy)) {
    return { ok: false, error: `bridge.py not found at ${config.bridgeDir}`, data: null };
  }
  if (!existsSync(config.bridgeDir)) mkdirSync(config.bridgeDir, { recursive: true, mode: 0o700 });

  const artifacts = createColdArtifacts(config.bridgeDir);
  try {
    writeColdTask(artifacts, task);
    writeFileSync(
      artifacts.cmdFile,
      [
        "@echo off",
        `"${config.codesysExe}" --noUI --profile="${config.codesysProfile}" --runscript="${bridgePy}"`,
        ""
      ].join("\r\n"),
      { encoding: "utf8", mode: 0o600 }
    );

    await new Promise<void>((resolve, reject) => {
      const child = spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", artifacts.cmdFile], {
        windowsHide: true,
        env: {
          ...process.env,
          CB_TASK: artifacts.taskFile,
          CB_RESULT: artifacts.resultFile
        }
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`CODESYS bridge timed out after ${config.timeoutMs} ms.`));
      }, config.timeoutMs);
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to start CODESYS: ${err.message}`));
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    if (!existsSync(artifacts.resultFile)) {
      return {
        ok: false,
        error: "CODESYS finished without writing a result. Check ScriptEngine and CODESYS_PROFILE.",
        data: null
      };
    }
    try {
      return JSON.parse(readFileSync(artifacts.resultFile, "utf8")) as BridgeResult;
    } catch {
      return { ok: false, error: "Failed to parse the CODESYS bridge result.", data: null };
    }
  } finally {
    cleanupColdArtifacts(artifacts);
  }
}
