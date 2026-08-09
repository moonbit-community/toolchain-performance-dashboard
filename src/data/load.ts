import type { BenchmarkRunV1, RunIndexV1 } from "./types.js";
import { parseBenchmarkRunJson, parseRunIndexJson } from "./validation.js";

export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchText(fetcher: FetchLike, url: string, label: string): Promise<string> {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} request failed with HTTP ${response.status}`);
  }
  return response.text();
}

export async function loadRunIndex(fetcher: FetchLike, url: string): Promise<RunIndexV1> {
  return parseRunIndexJson(await fetchText(fetcher, url, "Benchmark index"));
}

export async function loadBenchmarkRun(
  fetcher: FetchLike,
  url: string,
): Promise<BenchmarkRunV1> {
  return parseBenchmarkRunJson(await fetchText(fetcher, url, "Benchmark run"));
}
