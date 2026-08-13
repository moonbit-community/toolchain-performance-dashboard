export const SCHEMA_VERSION = 1 as const;

export const OS_IDS = ["ubuntu", "windows", "macos"] as const;
export type OsId = (typeof OS_IDS)[number];

export const BACKENDS = ["wasm", "wasm-gc", "js", "native"] as const;
export type Backend = (typeof BACKENDS)[number];

export const CANDIDATE_CHANNELS = ["pre-release", "nightly"] as const;
export type CandidateChannel = (typeof CANDIDATE_CHANNELS)[number];
export type ToolchainChannel = "stable" | CandidateChannel;
export type ToolchainRole = "stable" | "candidate";

export const UNIT_STATUSES = ["ok", "failed", "timeout", "unavailable"] as const;
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export type SampleStatus = Exclude<UnitStatus, "unavailable">;

export interface ToolchainVersionV1 {
  channel: ToolchainChannel;
  requestedVersion: "latest" | "pre-release" | "nightly";
  installationStatus: "ok" | "unavailable";
  parseStatus: "ok" | "failed";
  rawVersion: string;
  version: string | null;
  commit: string | null;
  date: string | null;
  normalized: string | null;
  errorSummary: string | null;
}

export interface CandidateSelectionV1 {
  selectedChannel: CandidateChannel;
  stableMatchesPreRelease: boolean | null;
  reason:
    | "pre-release-differs"
    | "pre-release-matches-stable"
    | "version-unavailable";
}

export interface ToolchainPairV1 {
  os: OsId;
  stable: ToolchainVersionV1;
  preRelease: ToolchainVersionV1;
  candidate: ToolchainVersionV1;
  selection: CandidateSelectionV1;
}

export interface RunnerCpuV1 {
  model: string;
  logicalCores: number;
  speedMHz: number | null;
}

export interface RunnerInfoV1 {
  os: OsId;
  label: string;
  architecture: string;
  name: string;
  environment: string;
  imageOs: string | null;
  imageVersion: string | null;
  cpu: RunnerCpuV1;
}

export interface BenchmarkCommandV1 {
  executable: "moon";
  argsTemplate: readonly [
    "check",
    "--target",
    "<backend>",
    "--target-dir",
    "<fresh-dir>",
    "--frozen",
    "--quiet",
  ];
  environment: {
    MOONC_RC_CONVENTION: "borrow";
  };
  iterations: 5;
  timeoutMs: 120000;
  warmup: false;
  freshTargetDir: true;
  ordering: "alternating-first";
}

export interface BenchmarkSampleV1 {
  iteration: number;
  sequence: number;
  role: ToolchainRole;
  channel: ToolchainChannel;
  targetDirId: string;
  startedAt: string;
  durationMs: number;
  status: SampleStatus;
  exitCode: number | null;
  errorSummary: string | null;
}

export interface BenchmarkStatsV1 {
  minMs: number;
  medianMs: number;
  maxMs: number;
}

export interface BenchmarkErrorV1 {
  iteration: number | null;
  exitCode: number | null;
  summary: string;
}

export interface BenchmarkUnitV1 {
  id: string;
  os: OsId;
  backend: Backend;
  role: ToolchainRole;
  channel: ToolchainChannel;
  status: UnitStatus;
  samples: BenchmarkSampleV1[];
  stats: BenchmarkStatsV1 | null;
  error: BenchmarkErrorV1 | null;
}

export interface BenchmarkComparisonV1 {
  id: string;
  os: OsId;
  backend: Backend;
  candidateChannel: CandidateChannel;
  status: UnitStatus;
  stableMedianMs: number | null;
  candidateMedianMs: number | null;
  deltaPercent: number | null;
  errorSummary: string | null;
}

export interface CoreRevisionV1 {
  repository: "moonbitlang/core";
  sha: string;
  url: string;
}

export interface WorkflowMetadataV1 {
  repository: string;
  runId: string;
  runAttempt: number;
  runNumber: number;
  event: string;
  ref: string;
  sha: string;
  url: string;
}

export interface BenchmarkHealthV1 {
  status: "healthy" | "partial" | "failed";
  totalUnits: number;
  okUnits: number;
  failedUnits: number;
  totalComparisons: number;
  okComparisons: number;
  parseFailures: number;
}

export interface BenchmarkShardV1 {
  schemaVersion: 1;
  kind: "benchmark-shard";
  os: OsId;
  startedAt: string;
  completedAt: string;
  core: CoreRevisionV1;
  runner: RunnerInfoV1;
  toolchains: ToolchainPairV1;
  command: BenchmarkCommandV1;
  units: BenchmarkUnitV1[];
}

export interface BenchmarkRunV1 {
  schemaVersion: 1;
  kind: "benchmark-run";
  id: string;
  startedAt: string;
  completedAt: string;
  collectedAt: string;
  core: CoreRevisionV1;
  workflow: WorkflowMetadataV1;
  command: BenchmarkCommandV1;
  runners: RunnerInfoV1[];
  toolchains: ToolchainPairV1[];
  units: BenchmarkUnitV1[];
  comparisons: BenchmarkComparisonV1[];
  health: BenchmarkHealthV1;
}

export interface RunSummaryV1 {
  schemaVersion: 1;
  id: string;
  startedAt: string;
  completedAt: string;
  coreSha: CoreRevisionV1["sha"];
  workflow: WorkflowMetadataV1;
  toolchains: ToolchainPairV1[];
  comparisons: BenchmarkComparisonV1[];
  health: BenchmarkHealthV1;
}

export interface RunIndexV1 {
  schemaVersion: 1;
  generatedAt: string;
  runs: RunSummaryV1[];
}

export function coreRevision(sha: string): CoreRevisionV1 {
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Core revision must be a full Git commit SHA");
  }
  return {
    repository: "moonbitlang/core",
    sha,
    url: `https://github.com/moonbitlang/core/commit/${sha}`,
  };
}

export const BENCHMARK_COMMAND: BenchmarkCommandV1 = {
  executable: "moon",
  argsTemplate: [
    "check",
    "--target",
    "<backend>",
    "--target-dir",
    "<fresh-dir>",
    "--frozen",
    "--quiet",
  ],
  environment: {
    MOONC_RC_CONVENTION: "borrow",
  },
  iterations: 5,
  timeoutMs: 120_000,
  warmup: false,
  freshTargetDir: true,
  ordering: "alternating-first",
};
