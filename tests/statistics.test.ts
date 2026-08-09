import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createComparison } from "../scripts/lib/aggregate.js";
import { calculateDeltaPercent, calculateStats, median } from "../scripts/lib/statistics.js";
import { makeUnit } from "./helpers.js";

describe("benchmark statistics", () => {
  it("calculates odd and even medians without mutating the input", () => {
    const values = [9, 2, 5, 1, 7];
    assert.equal(median(values), 5);
    assert.deepEqual(values, [9, 2, 5, 1, 7]);
    assert.equal(median([1, 2, 8, 9]), 5);
    assert.equal(median([]), null);
  });

  it("calculates min, median, max and the signed candidate delta", () => {
    assert.deepEqual(calculateStats([110, 80, 100, 90, 120]), {
      minMs: 80,
      medianMs: 100,
      maxMs: 120,
    });
    assert.equal(calculateDeltaPercent(100, 90), -10);
    assert.equal(calculateDeltaPercent(80, 100), 25);
  });

  it("excludes failed and timed-out units from comparisons", () => {
    const stable = makeUnit("ubuntu", "wasm", "stable");
    const failed = {
      ...makeUnit("ubuntu", "wasm", "candidate"),
      status: "failed" as const,
      stats: null,
      error: { iteration: 2, exitCode: 9, summary: "compiler failed" },
    };
    const failedComparison = createComparison(stable, failed);
    assert.equal(failedComparison.status, "failed");
    assert.equal(failedComparison.deltaPercent, null);
    assert.equal(failedComparison.candidateMedianMs, null);

    const timedOut = {
      ...failed,
      status: "timeout" as const,
      error: { iteration: 1, exitCode: null, summary: "timed out" },
    };
    assert.equal(createComparison(stable, timedOut).status, "timeout");
  });
});
