import {
  BACKENDS,
  BENCHMARK_COMMAND,
  SCHEMA_VERSION,
  type BenchmarkSampleV1,
  type BenchmarkShardV1,
  type BenchmarkUnitV1,
  type CandidateChannel,
  type OsId,
  type ToolchainChannel,
  type ToolchainPairV1,
  type ToolchainRole,
  type ToolchainVersionV1,
} from "../src/data/types.js";

export function makeToolchain(
  channel: ToolchainChannel,
  identity = channel === "stable" ? "v0.10.4+aaaaaaa" : "v0.10.5+bbbbbbb",
): ToolchainVersionV1 {
  const commit = identity.split("+")[1];
  return {
    channel,
    requestedVersion: channel === "stable" ? "latest" : channel,
    installationStatus: "ok",
    parseStatus: "ok",
    rawVersion: `moonc ${identity} (2026-08-09)`,
    version: identity,
    commit,
    date: "2026-08-09",
    normalized: `${identity.toLowerCase()}|${commit}|2026-08-09`,
    errorSummary: null,
  };
}

export function makeToolchainPair(
  os: OsId,
  candidateChannel: CandidateChannel = "pre-release",
): ToolchainPairV1 {
  const stable = makeToolchain("stable");
  const preRelease = makeToolchain("pre-release");
  const candidate =
    candidateChannel === "nightly" ? makeToolchain("nightly", "v0.10.6+ccccccc") : preRelease;
  return {
    os,
    stable,
    preRelease,
    candidate,
    selection: {
      selectedChannel: candidateChannel,
      stableMatchesPreRelease: candidateChannel === "nightly",
      reason:
        candidateChannel === "nightly"
          ? "pre-release-matches-stable"
          : "pre-release-differs",
    },
  };
}

function makeSample(
  iteration: number,
  role: ToolchainRole,
  channel: ToolchainChannel,
  durationMs: number,
): BenchmarkSampleV1 {
  return {
    iteration,
    sequence: iteration,
    role,
    channel,
    targetDirId: `${role}-${iteration}`,
    startedAt: `2026-08-09T02:00:0${iteration}.000Z`,
    durationMs,
    status: "ok",
    exitCode: 0,
    errorSummary: null,
  };
}

export function makeUnit(
  os: OsId,
  backend: (typeof BACKENDS)[number],
  role: ToolchainRole,
  candidateChannel: CandidateChannel = "pre-release",
): BenchmarkUnitV1 {
  const channel: ToolchainChannel = role === "stable" ? "stable" : candidateChannel;
  const base = role === "stable" ? 100 : 90;
  const samples = [1, 2, 3, 4, 5].map((iteration) =>
    makeSample(iteration, role, channel, base + iteration),
  );
  return {
    id: `${os}/${backend}/${role}`,
    os,
    backend,
    role,
    channel,
    status: "ok",
    samples,
    stats: {
      minMs: base + 1,
      medianMs: base + 3,
      maxMs: base + 5,
    },
    error: null,
  };
}

export function makeShard(
  os: OsId,
  candidateChannel: CandidateChannel = "pre-release",
): BenchmarkShardV1 {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: "benchmark-shard",
    os,
    startedAt: "2026-08-09T02:00:00.000Z",
    completedAt: "2026-08-09T02:10:00.000Z",
    runner: {
      os,
      label:
        os === "ubuntu" ? "ubuntu-24.04" : os === "windows" ? "windows-2025" : "macos-15",
      architecture: os === "macos" ? "arm64" : "x64",
      name: `test-${os}`,
      environment: "github-hosted",
      imageOs: os,
      imageVersion: "20260801.1",
      cpu: { model: "Fixture CPU", logicalCores: 4, speedMHz: 3000 },
    },
    toolchains: makeToolchainPair(os, candidateChannel),
    command: BENCHMARK_COMMAND,
    units: BACKENDS.flatMap((backend) => [
      makeUnit(os, backend, "stable", candidateChannel),
      makeUnit(os, backend, "candidate", candidateChannel),
    ]),
  };
}
