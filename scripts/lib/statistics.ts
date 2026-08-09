import type { BenchmarkStatsV1 } from "../../src/data/types.js";

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function calculateStats(values: readonly number[]): BenchmarkStatsV1 | null {
  const middle = median(values);
  if (middle === null) return null;
  return {
    minMs: Math.min(...values),
    medianMs: middle,
    maxMs: Math.max(...values),
  };
}

export function calculateDeltaPercent(stableMedian: number, candidateMedian: number): number {
  if (stableMedian <= 0) {
    throw new Error("Stable median must be greater than zero");
  }
  return ((candidateMedian - stableMedian) / stableMedian) * 100;
}
