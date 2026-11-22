import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface ColdArtifacts {
  taskFile: string;
  resultFile: string;
  cmdFile: string;
}

export function createColdArtifacts(bridgeDir: string): ColdArtifacts {
  const id = randomUUID();
  return {
    taskFile: path.join(bridgeDir, `task-${id}.json`),
    resultFile: path.join(bridgeDir, `result-${id}.json`),
    cmdFile: path.join(bridgeDir, `bridge-${id}.cmd`)
  };
}

export function writeColdTask(artifacts: ColdArtifacts, task: unknown): void {
  writeFileSync(artifacts.taskFile, JSON.stringify(task), {
    encoding: "utf8",
    mode: 0o600
  });
}

export function cleanupColdArtifacts(artifacts: ColdArtifacts): void {
  rmSync(artifacts.taskFile, { force: true });
  rmSync(artifacts.resultFile, { force: true });
  rmSync(artifacts.cmdFile, { force: true });
}
