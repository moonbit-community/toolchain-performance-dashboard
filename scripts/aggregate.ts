import { appendFile } from "node:fs/promises";
import path from "node:path";
import {
  aggregateShards,
  publishRun,
  readShards,
  workflowFromEnvironment,
} from "./lib/aggregate.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const artifactsDirectory = argument("--artifacts-dir");
  const dataDirectory = argument("--data-dir") ?? "public/data";
  if (!artifactsDirectory) throw new Error("--artifacts-dir is required");
  const shards = await readShards(path.resolve(artifactsDirectory));
  const run = aggregateShards(shards, workflowFromEnvironment(process.env));
  const result = await publishRun(path.resolve(dataDirectory), run);
  console.log(
    `${result.published ? "Published" : "Skipped duplicate"} run ${run.id} (${run.health.status})`,
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `run-file=${result.runFile}\nhealth-status=${run.health.status}\npublished=${String(result.published)}\n`,
      "utf8",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
