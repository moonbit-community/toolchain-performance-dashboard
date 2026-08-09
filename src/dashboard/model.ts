import {
  BACKENDS,
  OS_IDS,
  type Backend,
  type BenchmarkComparisonV1,
  type CandidateChannel,
  type OsId,
  type RunIndexV1,
  type RunSummaryV1,
  type UnitStatus,
} from "../data/types.js";

export type FilterValue<T extends string> = T | "all";
export type TimeRange = "7" | "30" | "90" | "all";

export interface DashboardFilters {
  os: FilterValue<OsId>;
  backend: FilterValue<Backend>;
  channel: FilterValue<CandidateChannel>;
  range: TimeRange;
}

export interface MatrixCell {
  os: OsId;
  backend: Backend;
  status: UnitStatus;
  candidateChannel: CandidateChannel;
  deltaPercent: number | null;
  stableMedianMs: number | null;
  candidateMedianMs: number | null;
  errorSummary: string | null;
}

export interface TrendPoint {
  timestamp: number;
  value: number;
  runId: string;
  channel: CandidateChannel;
}

export interface TrendSeries {
  id: string;
  name: string;
  os: OsId;
  backend: Backend;
  role: "stable" | "candidate" | "delta";
  channel: CandidateChannel | null;
  points: TrendPoint[];
}

export const DEFAULT_FILTERS: DashboardFilters = {
  os: "all",
  backend: "all",
  channel: "all",
  range: "30",
};

export const OS_LABELS: Record<OsId, string> = {
  ubuntu: "Ubuntu 24.04",
  windows: "Windows 2025",
  macos: "macOS 15",
};

export const BACKEND_LABELS: Record<Backend, string> = {
  wasm: "Wasm",
  "wasm-gc": "Wasm GC",
  js: "JavaScript",
  native: "Native",
};

function comparisonMatches(
  comparison: BenchmarkComparisonV1,
  filters: DashboardFilters,
): boolean {
  return (
    (filters.os === "all" || comparison.os === filters.os) &&
    (filters.backend === "all" || comparison.backend === filters.backend) &&
    (filters.channel === "all" || comparison.candidateChannel === filters.channel)
  );
}

export function rangeStart(range: TimeRange, now = Date.now()): number | null {
  if (range === "all") return null;
  return now - Number.parseInt(range, 10) * 24 * 60 * 60 * 1_000;
}

export function runsInRange(
  runs: readonly RunSummaryV1[],
  range: TimeRange,
  now = Date.now(),
): RunSummaryV1[] {
  const start = rangeStart(range, now);
  return runs
    .filter((run) => start === null || Date.parse(run.completedAt) >= start)
    .sort((left, right) => Date.parse(left.completedAt) - Date.parse(right.completedAt));
}

export function latestMatrix(summary: RunSummaryV1): MatrixCell[] {
  return OS_IDS.flatMap((os) =>
    BACKENDS.map((backend) => {
      const comparison = summary.comparisons.find(
        (candidate) => candidate.os === os && candidate.backend === backend,
      );
      return comparison
        ? { ...comparison }
        : {
            os,
            backend,
            status: "unavailable" as const,
            candidateChannel: "pre-release" as const,
            deltaPercent: null,
            stableMedianMs: null,
            candidateMedianMs: null,
            errorSummary: "No comparison was recorded",
          };
    }),
  );
}

function seriesName(
  os: OsId,
  backend: Backend,
  role: TrendSeries["role"],
  channel: CandidateChannel | null,
): string {
  const suffix = role === "stable" ? "stable" : channel ?? role;
  return `${OS_LABELS[os]} · ${BACKEND_LABELS[backend]} · ${suffix}`;
}

function upsertPoint(
  map: Map<string, TrendSeries>,
  key: string,
  details: Omit<TrendSeries, "id" | "name" | "points">,
  run: RunSummaryV1,
  value: number,
  channel: CandidateChannel,
): void {
  const series = map.get(key) ?? {
    id: key,
    name: seriesName(details.os, details.backend, details.role, details.channel),
    ...details,
    points: [],
  };
  series.points.push({
    timestamp: Date.parse(run.completedAt),
    value,
    runId: run.id,
    channel,
  });
  map.set(key, series);
}

export function buildMedianSeries(
  index: RunIndexV1,
  filters: DashboardFilters,
  now = Date.now(),
): TrendSeries[] {
  const series = new Map<string, TrendSeries>();
  for (const run of runsInRange(index.runs, filters.range, now)) {
    for (const comparison of run.comparisons) {
      if (
        comparison.status !== "ok" ||
        comparison.stableMedianMs === null ||
        comparison.candidateMedianMs === null ||
        !comparisonMatches(comparison, filters)
      ) {
        continue;
      }
      const base = `${comparison.os}/${comparison.backend}`;
      upsertPoint(
        series,
        `${base}/stable`,
        {
          os: comparison.os,
          backend: comparison.backend,
          role: "stable",
          channel: null,
        },
        run,
        comparison.stableMedianMs,
        comparison.candidateChannel,
      );
      upsertPoint(
        series,
        `${base}/candidate/${comparison.candidateChannel}`,
        {
          os: comparison.os,
          backend: comparison.backend,
          role: "candidate",
          channel: comparison.candidateChannel,
        },
        run,
        comparison.candidateMedianMs,
        comparison.candidateChannel,
      );
    }
  }
  return [...series.values()];
}

export function buildDeltaSeries(
  index: RunIndexV1,
  filters: DashboardFilters,
  now = Date.now(),
): TrendSeries[] {
  const series = new Map<string, TrendSeries>();
  for (const run of runsInRange(index.runs, filters.range, now)) {
    for (const comparison of run.comparisons) {
      if (
        comparison.status !== "ok" ||
        comparison.deltaPercent === null ||
        !comparisonMatches(comparison, filters)
      ) {
        continue;
      }
      const key = `${comparison.os}/${comparison.backend}/delta/${comparison.candidateChannel}`;
      upsertPoint(
        series,
        key,
        {
          os: comparison.os,
          backend: comparison.backend,
          role: "delta",
          channel: comparison.candidateChannel,
        },
        run,
        comparison.deltaPercent,
        comparison.candidateChannel,
      );
    }
  }
  return [...series.values()];
}

export function latestSeriesValues(series: readonly TrendSeries[]): TrendPoint[] {
  return series
    .map((item) => item.points[item.points.length - 1])
    .filter((point): point is TrendPoint => Boolean(point));
}
