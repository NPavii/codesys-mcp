import { execFileSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this check with: npm run pack:check");
const output = execFileSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024
});
const report = JSON.parse(output);
const pack = Array.isArray(report) ? report[0] : report;
if (!pack || !Array.isArray(pack.files)) throw new Error("Invalid npm pack report.");

const forbidden = [
  /(^|\/)queue\//,
  /(^|\/)snapshots\//,
  /(^|\/)__pycache__\//,
  /(^|\/)tests\//,
  /\.log$/,
  /\.pyc$/,
  /daemon_ping\.json$/,
  /bridge_daemon\.local\.ps1$/,
  /warm_projects\.txt$/,
  /(^|\/)prep_.*\.py$/,
  /(^|\/)img\d+\.png$/,
  /(^|\/)zzt_/,
  /(^|\/)(?:task|result)(?:-[^/]+)?\.json$/
];

const leaked = pack.files
  .map((entry) => entry.path)
  .filter((file) => forbidden.some((pattern) => pattern.test(file)));
if (leaked.length > 0) {
  throw new Error(`Forbidden files in npm package:\n${leaked.join("\n")}`);
}
if (pack.size > 25_000_000) {
  throw new Error(`npm package is unexpectedly large: ${pack.size} bytes.`);
}
console.log(`npm package check PASS: ${pack.files.length} files, ${pack.size} bytes.`);
