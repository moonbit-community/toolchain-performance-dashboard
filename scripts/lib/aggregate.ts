import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BACKENDS,
  BENCHMARK_COMMAND,
  CORE_REVISION,
  OS_IDS,
  SCHEMA_VERSION,
  type BenchmarkComparisonV1,
  type BenchmarkHealthV1,
  type BenchmarkRunV1,
  type BenchmarkShardV1,
  type BenchmarkUnitV1,
  type RunIndexV1,
  type RunSummaryV1,
  type UnitStatus,
  type WorkflowMetadataV1,
} from "../../src/data/types.js";
import {
  assertBenchmarkRunV1,
  assertBenchmarkShardV1,
  assertRunIndexV1,
} from "../../src/data/validation.js";
import { calculateDeltaPercent } from "./statistics.js";

const STATUS_PRIORITY: Record<UnitStatus, number> = {
  ok: 0,
  failed: 1,
  timeout: 2,
  unavailable: 3,
};

function worseStatus(left: UnitStatus, right: UnitStatus): UnitStatus {
  return STATUS_PRIORITY[left] >= STATUS_PRIORITY[right] ? left : right;
}

export function createComparison(
  stable: BenchmarkUnitV1,
  candidate: BenchmarkUnitV1,
): BenchmarkComparisonV1 {
  if (
    stable.os !== candidate.os ||
    stable.backend !== candidate.backend ||
    stable.role !== "stable" ||
    candidate.role !== "candidate"
  ) {
    throw new Error("Comparison units must be a matching stable/candidate pair");
  }
  const status = worseStatus(stable.status, candidate.status);
  const errorSummary = [stable.error?.summary, candidate.error?.summary]
    .filter((value): value is string => Boolean(value))
    .join("\n") || null;
  if (status !== "ok" || !stable.stats || !candidate.stats) {
    return {
      id: `${stable.os}/${stable.backend}`,
      os: stable.os,
      backend: stable.backend,
      candidateChannel: candidate.channel === "nightly" ? "nightly" : "pre-release",
      status,
      stableMedianMs: null,
      candidateMedianMs: null,
      deltaPercent: null,
      errorSummary,
    };
  }
  return {
    id: `${stable.os}/${stable.backend}`,
    os: stable.os,
    backend: stable.backend,
    candidateChannel: candidate.channel === "nightly" ? "nightly" : "pre-release",
    status: "ok",
    stableMedianMs: stable.stats.medianMs,
    candidateMedianMs: candidate.stats.medianMs,
    deltaPercent: calculateDeltaPercent(stable.stats.medianMs, candidate.stats.medianMs),
    errorSummary: null,
  };
}

function parseFailureCount(shards: readonly BenchmarkShardV1[]): number {
  return shards.reduce((total, shard) => {
    const versions = [shard.toolchains.stable, shard.toolchains.preRelease];
    if (shard.toolchains.candidate.channel === "nightly") {
      versions.push(shard.toolchains.candidate);
    }
    return (
      total +
      versions.filter(
        (toolchain) =>
          toolchain.installationStatus === "ok" && toolchain.parseStatus === "failed",
      ).length
    );
  }, 0);
}

export function calculateHealth(
  units: readonly BenchmarkUnitV1[],
  comparisons: readonly BenchmarkComparisonV1[],
  parseFailures: number,
): BenchmarkHealthV1 {
  const okUnits = units.filter((unit) => unit.status === "ok").length;
  const okComparisons = comparisons.filter((comparison) => comparison.status === "ok").length;
  const fullyHealthy =
    okUnits === units.length && okComparisons === comparisons.length && parseFailures === 0;
  const status: BenchmarkHealthV1["status"] = fullyHealthy
    ? "healthy"
    : okComparisons === 0
      ? "failed"
      : "partial";
  return {
    status,
    totalUnits: units.length,
    okUnits,
    failedUnits: units.length - okUnits,
    totalComparisons: comparisons.length,
    okComparisons,
    parseFailures,
  };
}

export function workflowFromEnvironment(environment: NodeJS.ProcessEnv): WorkflowMetadataV1 {
  const repository = environment.GITHUB_REPOSITORY ?? "local/toolchain-performance-dashboard";
  const runId = environment.GITHUB_RUN_ID ?? "local";
  const runAttempt = Number.parseInt(environment.GITHUB_RUN_ATTEMPT ?? "1", 10);
  const runNumber = Number.parseInt(environment.GITHUB_RUN_NUMBER ?? "0", 10);
  const serverUrl = environment.GITHUB_SERVER_URL ?? "https://github.com";
  return {
    repository,
    runId,
    runAttempt: Number.isFinite(runAttempt) ? runAttempt : 1,
    runNumber: Number.isFinite(runNumber) ? runNumber : 0,
    event: environment.GITHUB_EVENT_NAME ?? "local",
    ref: environment.GITHUB_REF ?? "refs/heads/main",
    sha: environment.GITHUB_SHA ?? "local",
    url: `${serverUrl}/${repository}/actions/runs/${runId}/attempts/${Number.isFinite(runAttempt) ? runAttempt : 1}`,
  };
}

export function aggregateShards(
  shards: readonly BenchmarkShardV1[],
  workflow: WorkflowMetadataV1,
  collectedAt = new Date().toISOString(),
): BenchmarkRunV1 {
  if (shards.length !== OS_IDS.length) {
    throw new Error(`Expected ${OS_IDS.length} OS shards, received ${shards.length}`);
  }
  const byOs = new Map(shards.map((shard) => [shard.os, shard]));
  for (const os of OS_IDS) {
    if (!byOs.has(os)) throw new Error(`Missing ${os} benchmark shard`);
  }
  const orderedShards = OS_IDS.map((os) => byOs.get(os)!);
  for (const shard of orderedShards) assertBenchmarkShardV1(shard);
  const units = orderedShards.flatMap((shard) => shard.units);
  const comparisons: BenchmarkComparisonV1[] = [];
  for (const os of OS_IDS) {
    for (const backend of BACKENDS) {
      const stable = units.find(
        (unit) => unit.os === os && unit.backend === backend && unit.role === "stable",
      );
      const candidate = units.find(
        (unit) => unit.os === os && unit.backend === backend && unit.role === "candidate",
      );
      if (!stable || !candidate) throw new Error(`Missing unit pair for ${os}/${backend}`);
      comparisons.push(createComparison(stable, candidate));
    }
  }
  const parseFailures = parseFailureCount(orderedShards);
  const run: BenchmarkRunV1 = {
    schemaVersion: SCHEMA_VERSION,
    kind: "benchmark-run",
    id: `${workflow.runId}-${workflow.runAttempt}`,
    startedAt: orderedShards
      .map((shard) => shard.startedAt)
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0],
    completedAt: orderedShards
      .map((shard) => shard.completedAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0],
    collectedAt,
    core: CORE_REVISION,
    workflow,
    command: BENCHMARK_COMMAND,
    runners: orderedShards.map((shard) => shard.runner),
    toolchains: orderedShards.map((shard) => shard.toolchains),
    units,
    comparisons,
    health: calculateHealth(units, comparisons, parseFailures),
  };
  assertBenchmarkRunV1(run);
  return run;
}

export function summarizeRun(run: BenchmarkRunV1): RunSummaryV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: run.id,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    coreSha: run.core.sha,
    workflow: run.workflow,
    toolchains: run.toolchains,
    comparisons: run.comparisons,
    health: run.health,
  };
}

function workflowKey(summary: RunSummaryV1): string {
  return `${summary.workflow.runId}/${summary.workflow.runAttempt}`;
}

export function sortAndDeduplicateSummaries(
  summaries: readonly RunSummaryV1[],
): RunSummaryV1[] {
  const seen = new Set<string>();
  return [...summaries]
    .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt))
    .filter((summary) => {
      const key = workflowKey(summary);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export interface PublishResult {
  runFile: string;
  published: boolean;
  index: RunIndexV1;
}

export async function publishRun(dataDirectory: string, run: BenchmarkRunV1): Promise<PublishResult> {
  assertBenchmarkRunV1(run);
  const indexFile = path.join(dataDirectory, "index.json");
  const runFile = path.join(dataDirectory, "runs", `${run.id}.json`);
  let current: RunIndexV1 = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: "1970-01-01T00:00:00.000Z",
    runs: [],
  };
  if (await exists(indexFile)) {
    current = JSON.parse(await readFile(indexFile, "utf8")) as RunIndexV1;
    assertRunIndexV1(current);
  }
  const duplicate = current.runs.some(
    (summary) =>
      summary.workflow.runId === run.workflow.runId &&
      summary.workflow.runAttempt === run.workflow.runAttempt,
  );
  if (duplicate && (await exists(runFile))) {
    return { runFile, published: false, index: current };
  }

  const index: RunIndexV1 = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: run.collectedAt,
    runs: sortAndDeduplicateSummaries([summarizeRun(run), ...current.runs]),
  };
  assertRunIndexV1(index);
  await atomicWriteJson(runFile, run);
  await atomicWriteJson(indexFile, index);
  return { runFile, published: true, index };
}

export async function readShards(directory: string): Promise<BenchmarkShardV1[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name));
  const shards: BenchmarkShardV1[] = [];
  for (const file of files) {
    const shard = JSON.parse(await readFile(file, "utf8")) as BenchmarkShardV1;
    assertBenchmarkShardV1(shard);
    shards.push(shard);
  }
  return shards;
}
