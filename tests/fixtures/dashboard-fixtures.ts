import {
  BACKENDS,
  OS_IDS,
  SCHEMA_VERSION,
  type BenchmarkComparisonV1,
  type CandidateChannel,
  type RunIndexV1,
  type RunSummaryV1,
  type UnitStatus,
} from "../../src/data/types.js";
import { makeToolchainPair } from "../helpers.js";

function workflow(runId: string, attempt = 1) {
  return {
    repository: "moonbit-community/toolchain-performance-dashboard",
    runId,
    runAttempt: attempt,
    runNumber: Number(runId),
    event: "schedule",
    ref: "refs/heads/main",
    sha: `sha-${runId}`,
    url: `https://github.com/moonbit-community/toolchain-performance-dashboard/actions/runs/${runId}/attempts/${attempt}`,
  };
}

function comparisons(
  channel: CandidateChannel,
  failedCell?: string,
): BenchmarkComparisonV1[] {
  return OS_IDS.flatMap((os, osIndex) =>
    BACKENDS.map((backend, backendIndex) => {
      const id = `${os}/${backend}`;
      const status: UnitStatus = id === failedCell ? "timeout" : "ok";
      const stableMedianMs = 100 + osIndex * 10 + backendIndex * 3;
      const deltaPercent = backendIndex % 2 === 0 ? -5 - osIndex : 4 + osIndex;
      return {
        id,
        os,
        backend,
        candidateChannel: channel,
        status,
        stableMedianMs: status === "ok" ? stableMedianMs : null,
        candidateMedianMs:
          status === "ok" ? stableMedianMs * (1 + deltaPercent / 100) : null,
        deltaPercent: status === "ok" ? deltaPercent : null,
        errorSummary: status === "ok" ? null : "Fixture process exceeded 120 seconds",
      };
    }),
  );
}

function summary(
  runId: string,
  completedAt: string,
  channel: CandidateChannel,
  failedCell?: string,
): RunSummaryV1 {
  const runComparisons = comparisons(channel, failedCell);
  const okComparisons = runComparisons.filter((comparison) => comparison.status === "ok").length;
  const failedUnits = failedCell ? 1 : 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: `${runId}-1`,
    startedAt: new Date(Date.parse(completedAt) - 10 * 60_000).toISOString(),
    completedAt,
    coreSha: "50c136025f4385ab131d82e68d79ebdd46ce50c2",
    workflow: workflow(runId),
    toolchains: OS_IDS.map((os) => makeToolchainPair(os, channel)),
    comparisons: runComparisons,
    health: {
      status: failedCell ? "partial" : "healthy",
      totalUnits: 24,
      okUnits: 24 - failedUnits,
      failedUnits,
      totalComparisons: 12,
      okComparisons,
      parseFailures: 0,
    },
  };
}

export const emptyIndexFixture: RunIndexV1 = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-08-09T00:00:00.000Z",
  runs: [],
};

export const normalIndexFixture: RunIndexV1 = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-08-09T02:15:00.000Z",
  runs: [summary("900", "2026-08-09T02:10:00.000Z", "pre-release")],
};

export const switchingIndexFixture: RunIndexV1 = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-08-09T02:15:00.000Z",
  runs: [
    summary("901", "2026-08-09T02:10:00.000Z", "nightly"),
    summary("900", "2026-08-08T02:10:00.000Z", "pre-release"),
  ],
};

export const partialIndexFixture: RunIndexV1 = {
  schemaVersion: SCHEMA_VERSION,
  generatedAt: "2026-08-09T02:15:00.000Z",
  runs: [summary("902", "2026-08-09T02:10:00.000Z", "nightly", "windows/native")],
};
