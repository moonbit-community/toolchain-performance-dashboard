import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { assertBenchmarkRunV1, assertRunIndexV1 } from "../src/data/validation.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const dataDirectory = path.resolve(argument("--data-dir") ?? "public/data");
  const indexValue = JSON.parse(await readFile(path.join(dataDirectory, "index.json"), "utf8")) as unknown;
  assertRunIndexV1(indexValue);
  const runsDirectory = path.join(dataDirectory, "runs");
  const entries = await readdir(runsDirectory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const value = JSON.parse(await readFile(path.join(runsDirectory, entry.name), "utf8")) as unknown;
    assertBenchmarkRunV1(value);
    count += 1;
  }
  console.log(`Validated index.json and ${count} benchmark run file(s)`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
