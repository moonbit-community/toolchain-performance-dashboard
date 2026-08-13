import { execFile } from "node:child_process";
import { mkdir, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  BACKENDS,
  BENCHMARK_COMMAND,
  OS_IDS,
  SCHEMA_VERSION,
  coreRevision,
  type BenchmarkShardV1,
  type BenchmarkUnitV1,
  type OsId,
} from "../src/data/types.js";
import { assertBenchmarkShardV1 } from "../src/data/validation.js";
import { installComparisonToolchains } from "./lib/install.js";
import { collectRunnerInfo } from "./lib/runner.js";
import { sampleBackendPair, type RuntimeToolchain } from "./lib/sampling.js";

const execFileAsync = promisify(execFile);

interface CliOptions {
  os: OsId;
  coreDirectory: string;
  output: string;
  tempDirectory: string;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseOptions(): CliOptions {
  const osValue = argument("--os");
  const coreDirectory = argument("--core-dir");
  const output = argument("--output");
  if (!osValue || !OS_IDS.includes(osValue as OsId)) {
    throw new Error(`--os must be one of ${OS_IDS.join(", ")}`);
  }
  const platformOs: Record<NodeJS.Platform, OsId | undefined> = {
    aix: undefined,
    android: undefined,
    darwin: "macos",
    freebsd: undefined,
    haiku: undefined,
    linux: "ubuntu",
    openbsd: undefined,
    sunos: undefined,
    win32: "windows",
    cygwin: undefined,
    netbsd: undefined,
  };
  if (platformOs[process.platform] !== osValue) {
    throw new Error(`--os ${osValue} does not match the current ${process.platform} runner`);
  }
  if (!coreDirectory) throw new Error("--core-dir is required");
  if (!output) throw new Error("--output is required");
  return {
    os: osValue as OsId,
    coreDirectory: path.resolve(coreDirectory),
    output: path.resolve(output),
    tempDirectory: path.resolve(
      argument("--temp-dir") ??
        path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), "moonbit-toolchain-benchmark", osValue),
    ),
  };
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function resolveCoreRevision(coreDirectory: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", coreDirectory, "rev-parse", "--verify", "HEAD^{commit}"],
      { encoding: "utf8" },
    );
    return coreRevision(stdout.trim());
  } catch (error) {
    throw new Error(`Unable to resolve the core Git revision in ${coreDirectory}`, {
      cause: error,
    });
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const core = await resolveCoreRevision(options.coreDirectory);
  const startedAt = new Date().toISOString();
  const installed = await installComparisonToolchains(
    options.os,
    path.join(options.tempDirectory, "toolchains"),
  );
  const stable: RuntimeToolchain = {
    role: "stable",
    channel: "stable",
    moonHome: installed.stable.moonHome,
    moonExecutable: installed.stable.moonExecutable,
    available: installed.stable.info.installationStatus === "ok",
    unavailableReason: installed.stable.info.errorSummary,
  };
  const candidate: RuntimeToolchain = {
    role: "candidate",
    channel: installed.candidate.info.channel,
    moonHome: installed.candidate.moonHome,
    moonExecutable: installed.candidate.moonExecutable,
    available: installed.candidate.info.installationStatus === "ok",
    unavailableReason: installed.candidate.info.errorSummary,
  };

  const units: BenchmarkUnitV1[] = [];
  let sequence = 1;
  for (const backend of BACKENDS) {
    const sampled = await sampleBackendPair({
      os: options.os,
      backend,
      coreDirectory: options.coreDirectory,
      targetRoot: path.join(options.tempDirectory, "targets"),
      stable,
      candidate,
      startingSequence: sequence,
    });
    units.push(...sampled.units);
    sequence = sampled.nextSequence;
  }

  const shard: BenchmarkShardV1 = {
    schemaVersion: SCHEMA_VERSION,
    kind: "benchmark-shard",
    os: options.os,
    startedAt,
    completedAt: new Date().toISOString(),
    core,
    runner: collectRunnerInfo(options.os),
    toolchains: installed.published,
    command: BENCHMARK_COMMAND,
    units,
  };
  assertBenchmarkShardV1(shard);
  await atomicWriteJson(options.output, shard);
  console.log(`Wrote ${units.length} benchmark units to ${options.output}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
