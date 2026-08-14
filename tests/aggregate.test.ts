import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  aggregateShards,
  publishRun,
  sortAndDeduplicateSummaries,
  summarizeRun,
} from "../scripts/lib/aggregate.js";
import { coreRevision, type WorkflowMetadataV1 } from "../src/data/types.js";
import { makeShard, TEST_CORE_SHA } from "./helpers.js";

const temporaryDirectories: string[] = [];
const workflow: WorkflowMetadataV1 = {
  repository: "moonbit-community/toolchain-performance-dashboard",
  runId: "123456",
  runAttempt: 2,
  runNumber: 44,
  event: "workflow_dispatch",
  ref: "refs/heads/main",
  sha: "abc123",
  url: "https://github.com/moonbit-community/toolchain-performance-dashboard/actions/runs/123456/attempts/2",
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("run aggregation and history publication", () => {
  it("combines three shards into 24 units, 720 samples, and 12 comparisons", () => {
    const run = aggregateShards(
      [makeShard("windows"), makeShard("macos"), makeShard("ubuntu")],
      workflow,
      "2026-08-09T02:11:00.000Z",
    );
    assert.equal(run.units.length, 24);
    assert.equal(run.units.flatMap((unit) => unit.samples).length, 720);
    assert.equal(run.comparisons.length, 12);
    assert.equal(run.health.status, "healthy");
    assert.equal(run.health.okUnits, 24);
    assert.equal(run.health.okComparisons, 12);
    assert.equal(run.core.sha, TEST_CORE_SHA);
    assert.deepEqual(run.runners.map((runner) => runner.os), ["ubuntu", "windows", "macos"]);
  });

  it("rejects shards collected from different core revisions", () => {
    assert.throws(
      () =>
        aggregateShards(
          [
            makeShard("ubuntu"),
            makeShard("windows"),
            makeShard(
              "macos",
              "pre-release",
              coreRevision("fedcba9876543210fedcba9876543210fedcba98"),
            ),
          ],
          workflow,
        ),
      /All OS shards must use the same core revision/,
    );
  });

  it("sorts newest first and deduplicates workflow run/attempt", () => {
    const run = aggregateShards(
      [makeShard("ubuntu"), makeShard("windows"), makeShard("macos")],
      workflow,
      "2026-08-09T02:11:00.000Z",
    );
    const older = {
      ...summarizeRun(run),
      id: "older",
      completedAt: "2026-08-01T00:00:00.000Z",
      workflow: { ...workflow, runId: "100", runAttempt: 1 },
    };
    const duplicate = {
      ...summarizeRun(run),
      id: "duplicate",
      completedAt: "2026-08-08T00:00:00.000Z",
    };
    const result = sortAndDeduplicateSummaries([older, duplicate, summarizeRun(run)]);
    assert.deepEqual(result.map((summary) => summary.id), ["123456-2", "older"]);
  });

  it("writes an idempotent run file and index", async () => {
    const dataDirectory = await mkdtemp(path.join(os.tmpdir(), "benchmark-data-"));
    temporaryDirectories.push(dataDirectory);
    const run = aggregateShards(
      [makeShard("ubuntu"), makeShard("windows"), makeShard("macos")],
      workflow,
      "2026-08-09T02:11:00.000Z",
    );
    const first = await publishRun(dataDirectory, run);
    const second = await publishRun(dataDirectory, run);
    assert.equal(first.published, true);
    assert.equal(second.published, false);
    const index = JSON.parse(await readFile(path.join(dataDirectory, "index.json"), "utf8")) as {
      runs: unknown[];
    };
    assert.equal(index.runs.length, 1);
  });
});
