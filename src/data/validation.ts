import {
  BACKENDS,
  CANDIDATE_CHANNELS,
  OS_IDS,
  UNIT_STATUSES,
  type BenchmarkComparisonV1,
  type BenchmarkHealthV1,
  type BenchmarkRunV1,
  type BenchmarkShardV1,
  type BenchmarkStatsV1,
  type BenchmarkUnitV1,
  type RunIndexV1,
  type RunSummaryV1,
  type RunnerInfoV1,
  type ToolchainPairV1,
  type ToolchainVersionV1,
  type WorkflowMetadataV1,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

export class DataValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataValidationError";
  }
}

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DataValidationError(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string") {
    throw new DataValidationError(`${path} must be a string`);
  }
}

function nonEmptyString(value: unknown, path: string): asserts value is string {
  string(value, path);
  if (value.length === 0) {
    throw new DataValidationError(`${path} must not be empty`);
  }
}

function finiteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataValidationError(`${path} must be a finite number`);
  }
}

function integer(value: unknown, path: string): asserts value is number {
  finiteNumber(value, path);
  if (!Number.isInteger(value)) {
    throw new DataValidationError(`${path} must be an integer`);
  }
}

function boolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new DataValidationError(`${path} must be a boolean`);
  }
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) string(value, path);
}

function nullableNumber(value: unknown, path: string): void {
  if (value !== null) finiteNumber(value, path);
}

function isoDate(value: unknown, path: string): asserts value is string {
  string(value, path);
  if (Number.isNaN(Date.parse(value))) {
    throw new DataValidationError(`${path} must be an ISO date`);
  }
}

function literal<const T extends readonly (string | number)[]>(
  value: unknown,
  allowed: T,
  path: string,
): asserts value is T[number] {
  if (!allowed.includes(value as never)) {
    throw new DataValidationError(`${path} must be one of ${allowed.join(", ")}`);
  }
}

function array(value: unknown, path: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new DataValidationError(`${path} must be an array`);
  }
}

function schemaVersion(value: unknown, path: string): void {
  if (value !== 1) {
    throw new DataValidationError(`${path} must equal 1`);
  }
}

function exactSet(actual: readonly string[], expected: readonly string[], path: string): void {
  if (actual.length !== expected.length || new Set(actual).size !== actual.length) {
    throw new DataValidationError(`${path} must contain ${expected.length} unique entries`);
  }
  const expectedValues = new Set(expected);
  if (actual.some((value) => !expectedValues.has(value))) {
    throw new DataValidationError(`${path} contains an unexpected entry`);
  }
}

function validateWorkflow(value: unknown, path: string): asserts value is WorkflowMetadataV1 {
  const item = record(value, path);
  for (const key of ["repository", "runId", "event", "ref", "sha", "url"] as const) {
    string(item[key], `${path}.${key}`);
  }
  integer(item.runAttempt, `${path}.runAttempt`);
  integer(item.runNumber, `${path}.runNumber`);
}

function validateToolchain(
  value: unknown,
  path: string,
): asserts value is ToolchainVersionV1 {
  const item = record(value, path);
  literal(item.channel, ["stable", "pre-release", "nightly"] as const, `${path}.channel`);
  literal(
    item.requestedVersion,
    ["latest", "pre-release", "nightly"] as const,
    `${path}.requestedVersion`,
  );
  literal(item.installationStatus, ["ok", "unavailable"] as const, `${path}.installationStatus`);
  literal(item.parseStatus, ["ok", "failed"] as const, `${path}.parseStatus`);
  string(item.rawVersion, `${path}.rawVersion`);
  nullableString(item.version, `${path}.version`);
  nullableString(item.commit, `${path}.commit`);
  nullableString(item.date, `${path}.date`);
  nullableString(item.normalized, `${path}.normalized`);
  nullableString(item.errorSummary, `${path}.errorSummary`);
}

function validateToolchainPair(value: unknown, path: string): asserts value is ToolchainPairV1 {
  const item = record(value, path);
  literal(item.os, OS_IDS, `${path}.os`);
  validateToolchain(item.stable, `${path}.stable`);
  validateToolchain(item.preRelease, `${path}.preRelease`);
  validateToolchain(item.candidate, `${path}.candidate`);
  const selection = record(item.selection, `${path}.selection`);
  literal(selection.selectedChannel, CANDIDATE_CHANNELS, `${path}.selection.selectedChannel`);
  if (selection.stableMatchesPreRelease !== null) {
    boolean(selection.stableMatchesPreRelease, `${path}.selection.stableMatchesPreRelease`);
  }
  literal(
    selection.reason,
    ["pre-release-differs", "pre-release-matches-stable", "version-unavailable"] as const,
    `${path}.selection.reason`,
  );
  const candidate = record(item.candidate, `${path}.candidate`);
  if (candidate.channel !== selection.selectedChannel) {
    throw new DataValidationError(`${path}.candidate.channel must match the selected channel`);
  }
}

function validateRunner(value: unknown, path: string): asserts value is RunnerInfoV1 {
  const item = record(value, path);
  literal(item.os, OS_IDS, `${path}.os`);
  for (const key of ["label", "architecture", "name", "environment"] as const) {
    string(item[key], `${path}.${key}`);
  }
  nullableString(item.imageOs, `${path}.imageOs`);
  nullableString(item.imageVersion, `${path}.imageVersion`);
  const cpu = record(item.cpu, `${path}.cpu`);
  string(cpu.model, `${path}.cpu.model`);
  integer(cpu.logicalCores, `${path}.cpu.logicalCores`);
  nullableNumber(cpu.speedMHz, `${path}.cpu.speedMHz`);
}

function validateCommand(value: unknown, path: string): void {
  const item = record(value, path);
  if (item.executable !== "moon") throw new DataValidationError(`${path}.executable must equal moon`);
  array(item.argsTemplate, `${path}.argsTemplate`);
  const expected = [
    "check",
    "--target",
    "<backend>",
    "--target-dir",
    "<fresh-dir>",
    "--frozen",
    "--quiet",
  ];
  if (item.argsTemplate.length !== expected.length || item.argsTemplate.some((part, i) => part !== expected[i])) {
    throw new DataValidationError(`${path}.argsTemplate is not the V1 benchmark command`);
  }
  const environment = record(item.environment, `${path}.environment`);
  if (environment.MOONC_RC_CONVENTION !== "borrow") {
    throw new DataValidationError(`${path}.environment.MOONC_RC_CONVENTION must equal borrow`);
  }
  if (item.iterations !== 5 || item.timeoutMs !== 120_000 || item.warmup !== false || item.freshTargetDir !== true || item.ordering !== "alternating-first") {
    throw new DataValidationError(`${path} does not match the V1 benchmark protocol`);
  }
}

function validateStats(value: unknown, path: string): asserts value is BenchmarkStatsV1 {
  const item = record(value, path);
  finiteNumber(item.minMs, `${path}.minMs`);
  finiteNumber(item.medianMs, `${path}.medianMs`);
  finiteNumber(item.maxMs, `${path}.maxMs`);
  if (item.minMs > item.medianMs || item.medianMs > item.maxMs) {
    throw new DataValidationError(`${path} must satisfy min <= median <= max`);
  }
}

function validateUnit(value: unknown, path: string): asserts value is BenchmarkUnitV1 {
  const item = record(value, path);
  nonEmptyString(item.id, `${path}.id`);
  literal(item.os, OS_IDS, `${path}.os`);
  literal(item.backend, BACKENDS, `${path}.backend`);
  literal(item.role, ["stable", "candidate"] as const, `${path}.role`);
  literal(item.channel, ["stable", "pre-release", "nightly"] as const, `${path}.channel`);
  literal(item.status, UNIT_STATUSES, `${path}.status`);
  array(item.samples, `${path}.samples`);
  item.samples.forEach((sampleValue, index) => {
    const sample = record(sampleValue, `${path}.samples[${index}]`);
    integer(sample.iteration, `${path}.samples[${index}].iteration`);
    integer(sample.sequence, `${path}.samples[${index}].sequence`);
    literal(sample.role, ["stable", "candidate"] as const, `${path}.samples[${index}].role`);
    literal(sample.channel, ["stable", "pre-release", "nightly"] as const, `${path}.samples[${index}].channel`);
    nonEmptyString(sample.targetDirId, `${path}.samples[${index}].targetDirId`);
    isoDate(sample.startedAt, `${path}.samples[${index}].startedAt`);
    finiteNumber(sample.durationMs, `${path}.samples[${index}].durationMs`);
    literal(sample.status, ["ok", "failed", "timeout"] as const, `${path}.samples[${index}].status`);
    nullableNumber(sample.exitCode, `${path}.samples[${index}].exitCode`);
    nullableString(sample.errorSummary, `${path}.samples[${index}].errorSummary`);
  });
  if (item.stats !== null) validateStats(item.stats, `${path}.stats`);
  if (item.error !== null) {
    const error = record(item.error, `${path}.error`);
    if (error.iteration !== null) integer(error.iteration, `${path}.error.iteration`);
    if (error.exitCode !== null) integer(error.exitCode, `${path}.error.exitCode`);
    string(error.summary, `${path}.error.summary`);
  }
  if (item.status === "ok" && (item.samples.length !== 5 || item.stats === null)) {
    throw new DataValidationError(`${path} ok units must contain five samples and stats`);
  }
  if (item.status !== "ok" && item.stats !== null) {
    throw new DataValidationError(`${path} non-ok units must not contain stats`);
  }
  if (item.status === "unavailable" && item.samples.length !== 0) {
    throw new DataValidationError(`${path} unavailable units must not contain samples`);
  }
  if (item.status !== "unavailable" && item.samples.length !== 5) {
    throw new DataValidationError(`${path} measured units must contain five samples`);
  }
  if (item.status !== "ok" && item.error === null) {
    throw new DataValidationError(`${path} non-ok units must include an error`);
  }
}

function validateComparison(
  value: unknown,
  path: string,
): asserts value is BenchmarkComparisonV1 {
  const item = record(value, path);
  nonEmptyString(item.id, `${path}.id`);
  literal(item.os, OS_IDS, `${path}.os`);
  literal(item.backend, BACKENDS, `${path}.backend`);
  literal(item.candidateChannel, CANDIDATE_CHANNELS, `${path}.candidateChannel`);
  literal(item.status, UNIT_STATUSES, `${path}.status`);
  nullableNumber(item.stableMedianMs, `${path}.stableMedianMs`);
  nullableNumber(item.candidateMedianMs, `${path}.candidateMedianMs`);
  nullableNumber(item.deltaPercent, `${path}.deltaPercent`);
  nullableString(item.errorSummary, `${path}.errorSummary`);
  if (
    item.status === "ok" &&
    (item.stableMedianMs === null || item.candidateMedianMs === null || item.deltaPercent === null)
  ) {
    throw new DataValidationError(`${path} ok comparisons require both medians and a delta`);
  }
  if (
    item.status !== "ok" &&
    (item.stableMedianMs !== null || item.candidateMedianMs !== null || item.deltaPercent !== null)
  ) {
    throw new DataValidationError(`${path} non-ok comparisons must not contain metrics`);
  }
  if (item.status !== "ok" && item.errorSummary === null) {
    throw new DataValidationError(`${path} non-ok comparisons must include an error summary`);
  }
}

function validateHealth(value: unknown, path: string): asserts value is BenchmarkHealthV1 {
  const item = record(value, path);
  literal(item.status, ["healthy", "partial", "failed"] as const, `${path}.status`);
  for (const key of [
    "totalUnits",
    "okUnits",
    "failedUnits",
    "totalComparisons",
    "okComparisons",
    "parseFailures",
  ] as const) {
    integer(item[key], `${path}.${key}`);
  }
}

function validateSummary(value: unknown, path: string): asserts value is RunSummaryV1 {
  const item = record(value, path);
  schemaVersion(item.schemaVersion, `${path}.schemaVersion`);
  nonEmptyString(item.id, `${path}.id`);
  isoDate(item.startedAt, `${path}.startedAt`);
  isoDate(item.completedAt, `${path}.completedAt`);
  if (item.coreSha !== "50c136025f4385ab131d82e68d79ebdd46ce50c2") {
    throw new DataValidationError(`${path}.coreSha is not the fixed core revision`);
  }
  validateWorkflow(item.workflow, `${path}.workflow`);
  array(item.toolchains, `${path}.toolchains`);
  item.toolchains.forEach((toolchain, index) => validateToolchainPair(toolchain, `${path}.toolchains[${index}]`));
  exactSet(
    item.toolchains.map((toolchain) => record(toolchain, `${path}.toolchains`).os as string),
    OS_IDS,
    `${path}.toolchains`,
  );
  array(item.comparisons, `${path}.comparisons`);
  item.comparisons.forEach((comparison, index) => validateComparison(comparison, `${path}.comparisons[${index}]`));
  exactSet(
    item.comparisons.map((comparison) => {
      const entry = record(comparison, `${path}.comparisons`);
      return `${String(entry.os)}/${String(entry.backend)}`;
    }),
    OS_IDS.flatMap((os) => BACKENDS.map((backend) => `${os}/${backend}`)),
    `${path}.comparisons`,
  );
  validateHealth(item.health, `${path}.health`);
}

export function assertRunIndexV1(value: unknown): asserts value is RunIndexV1 {
  const item = record(value, "index");
  schemaVersion(item.schemaVersion, "index.schemaVersion");
  isoDate(item.generatedAt, "index.generatedAt");
  array(item.runs, "index.runs");
  item.runs.forEach((run, index) => validateSummary(run, `index.runs[${index}]`));
  for (let index = 1; index < item.runs.length; index += 1) {
    const previous = record(item.runs[index - 1], `index.runs[${index - 1}]`);
    const current = record(item.runs[index], `index.runs[${index}]`);
    if (Date.parse(previous.completedAt as string) < Date.parse(current.completedAt as string)) {
      throw new DataValidationError("index.runs must be sorted newest first");
    }
  }
  const workflowKeys = item.runs.map((run, index) => {
    const summary = record(run, `index.runs[${index}]`);
    const workflow = record(summary.workflow, `index.runs[${index}].workflow`);
    return `${String(workflow.runId)}/${String(workflow.runAttempt)}`;
  });
  if (new Set(workflowKeys).size !== workflowKeys.length) {
    throw new DataValidationError("index.runs contains a duplicate workflow run/attempt");
  }
}

export function assertBenchmarkShardV1(value: unknown): asserts value is BenchmarkShardV1 {
  const item = record(value, "shard");
  schemaVersion(item.schemaVersion, "shard.schemaVersion");
  if (item.kind !== "benchmark-shard") throw new DataValidationError("shard.kind must equal benchmark-shard");
  literal(item.os, OS_IDS, "shard.os");
  isoDate(item.startedAt, "shard.startedAt");
  isoDate(item.completedAt, "shard.completedAt");
  validateRunner(item.runner, "shard.runner");
  validateToolchainPair(item.toolchains, "shard.toolchains");
  validateCommand(item.command, "shard.command");
  array(item.units, "shard.units");
  item.units.forEach((unit, index) => validateUnit(unit, `shard.units[${index}]`));
  exactSet(
    item.units.map((unit) => {
      const entry = record(unit, "shard.units");
      if (entry.os !== item.os) throw new DataValidationError("shard units must match shard.os");
      return `${String(entry.backend)}/${String(entry.role)}`;
    }),
    BACKENDS.flatMap((backend) => [`${backend}/stable`, `${backend}/candidate`]),
    "shard.units",
  );
  if (record(item.runner, "shard.runner").os !== item.os || record(item.toolchains, "shard.toolchains").os !== item.os) {
    throw new DataValidationError("shard runner and toolchain OS must match shard.os");
  }
}

export function assertBenchmarkRunV1(value: unknown): asserts value is BenchmarkRunV1 {
  const item = record(value, "run");
  schemaVersion(item.schemaVersion, "run.schemaVersion");
  if (item.kind !== "benchmark-run") throw new DataValidationError("run.kind must equal benchmark-run");
  nonEmptyString(item.id, "run.id");
  isoDate(item.startedAt, "run.startedAt");
  isoDate(item.completedAt, "run.completedAt");
  isoDate(item.collectedAt, "run.collectedAt");
  const core = record(item.core, "run.core");
  if (
    core.repository !== "moonbitlang/core" ||
    core.sha !== "50c136025f4385ab131d82e68d79ebdd46ce50c2" ||
    core.url !== "https://github.com/moonbitlang/core/commit/50c136025f4385ab131d82e68d79ebdd46ce50c2"
  ) {
    throw new DataValidationError("run.core must be the fixed V1 core revision");
  }
  validateWorkflow(item.workflow, "run.workflow");
  validateCommand(item.command, "run.command");
  array(item.runners, "run.runners");
  item.runners.forEach((runner, index) => validateRunner(runner, `run.runners[${index}]`));
  exactSet(
    item.runners.map((runner) => record(runner, "run.runners").os as string),
    OS_IDS,
    "run.runners",
  );
  array(item.toolchains, "run.toolchains");
  item.toolchains.forEach((toolchain, index) => validateToolchainPair(toolchain, `run.toolchains[${index}]`));
  exactSet(
    item.toolchains.map((toolchain) => record(toolchain, "run.toolchains").os as string),
    OS_IDS,
    "run.toolchains",
  );
  array(item.units, "run.units");
  item.units.forEach((unit, index) => validateUnit(unit, `run.units[${index}]`));
  exactSet(
    item.units.map((unit) => record(unit, "run.units").id as string),
    OS_IDS.flatMap((os) =>
      BACKENDS.flatMap((backend) => [`${os}/${backend}/stable`, `${os}/${backend}/candidate`]),
    ),
    "run.units",
  );
  array(item.comparisons, "run.comparisons");
  item.comparisons.forEach((comparison, index) => validateComparison(comparison, `run.comparisons[${index}]`));
  exactSet(
    item.comparisons.map((comparison) => record(comparison, "run.comparisons").id as string),
    OS_IDS.flatMap((os) => BACKENDS.map((backend) => `${os}/${backend}`)),
    "run.comparisons",
  );
  validateHealth(item.health, "run.health");
  const health = item.health;
  if (
    health.totalUnits !== item.units.length ||
    health.okUnits + health.failedUnits !== health.totalUnits ||
    health.totalComparisons !== item.comparisons.length
  ) {
    throw new DataValidationError("run.health counts do not match the run payload");
  }
}

export function parseRunIndexJson(text: string): RunIndexV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new DataValidationError(
      `index.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertRunIndexV1(value);
  return value;
}

export function parseBenchmarkRunJson(text: string): BenchmarkRunV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new DataValidationError(
      `benchmark run is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  assertBenchmarkRunV1(value);
  return value;
}
