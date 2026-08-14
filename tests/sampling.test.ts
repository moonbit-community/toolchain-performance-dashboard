import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createAlternatingSchedule, sampleBackendPair } from "../scripts/lib/sampling.js";

const temporaryDirectories: string[] = [];

async function fakeMoon(): Promise<{ root: string; script: string; log: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "fake-moon-"));
  temporaryDirectories.push(root);
  const script = path.join(root, "fake-moon.mjs");
  const log = path.join(root, "calls.ndjson");
  await writeFile(
    script,
    `import { appendFileSync, existsSync, mkdirSync } from "node:fs";
const args = process.argv.slice(2);
const targetIndex = args.indexOf("--target-dir");
const target = args[targetIndex + 1];
appendFileSync(process.env.FAKE_MOON_LOG, JSON.stringify({
  role: process.env.MOONBIT_BENCHMARK_ROLE,
  args,
  target,
  existedBefore: existsSync(target),
}) + "\\n");
mkdirSync(target, { recursive: true });
if (process.env.FAKE_MOON_MODE === "fail") process.exit(17);
if (process.env.FAKE_MOON_MODE === "timeout") await new Promise((resolve) => setTimeout(resolve, 500));
`,
    "utf8",
  );
  return { root, script, log };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("paired sampling", () => {
  it("runs 30 samples, alternates the first toolchain, and uses fresh target directories", async () => {
    const fake = await fakeMoon();
    const result = await sampleBackendPair({
      os: "ubuntu",
      backend: "wasm-gc",
      coreDirectory: fake.root,
      targetRoot: path.join(fake.root, "targets"),
      stable: {
        role: "stable",
        channel: "stable",
        moonHome: path.join(fake.root, "stable-home"),
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log },
        available: true,
        unavailableReason: null,
      },
      candidate: {
        role: "candidate",
        channel: "pre-release",
        moonHome: path.join(fake.root, "candidate-home"),
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log },
        available: true,
        unavailableReason: null,
      },
      timeoutMs: 2_000,
    });

    const schedule = createAlternatingSchedule();
    assert.equal(schedule.length, 60);
    assert.deepEqual(schedule.slice(0, 10).map((item) => item.role), [
      "stable",
      "candidate",
      "candidate",
      "stable",
      "stable",
      "candidate",
      "candidate",
      "stable",
      "stable",
      "candidate",
    ]);
    assert.equal(result.units[0].samples.length, 30);
    assert.equal(result.units[1].samples.length, 30);
    assert.equal(result.units.every((unit) => unit.status === "ok" && unit.stats !== null), true);

    const calls = (await readFile(fake.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { role: string; args: string[]; target: string; existedBefore: boolean });
    assert.deepEqual(calls.map((call) => call.role), schedule.map((item) => item.role));
    assert.equal(new Set(calls.map((call) => call.target)).size, 60);
    assert.equal(calls.every((call) => call.existedBefore === false), true);
    assert.equal(
      calls.every(
        (call) =>
          call.args[0] === "check" &&
          call.args.includes("--target-dir") &&
          call.args.includes("--frozen") &&
          call.args.at(-1) === "--quiet",
      ),
      true,
    );
  });

  it("captures exit codes and suppresses statistics for failures", async () => {
    const fake = await fakeMoon();
    const result = await sampleBackendPair({
      os: "ubuntu",
      backend: "js",
      coreDirectory: fake.root,
      targetRoot: path.join(fake.root, "targets"),
      stable: {
        role: "stable",
        channel: "stable",
        moonHome: fake.root,
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log },
        available: true,
        unavailableReason: null,
      },
      candidate: {
        role: "candidate",
        channel: "nightly",
        moonHome: fake.root,
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log, FAKE_MOON_MODE: "fail" },
        available: true,
        unavailableReason: null,
      },
      timeoutMs: 2_000,
    });
    assert.equal(result.units[0].status, "ok");
    assert.equal(result.units[1].status, "failed");
    assert.equal(result.units[1].samples.every((sample) => sample.exitCode === 17), true);
    assert.equal(result.units[1].stats, null);
  });

  it("terminates and records timed-out processes", async () => {
    const fake = await fakeMoon();
    const result = await sampleBackendPair({
      os: "ubuntu",
      backend: "native",
      coreDirectory: fake.root,
      targetRoot: path.join(fake.root, "targets"),
      stable: {
        role: "stable",
        channel: "stable",
        moonHome: fake.root,
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log },
        available: true,
        unavailableReason: null,
      },
      candidate: {
        role: "candidate",
        channel: "pre-release",
        moonHome: fake.root,
        moonExecutable: process.execPath,
        executableArgsPrefix: [fake.script],
        extraEnvironment: { FAKE_MOON_LOG: fake.log, FAKE_MOON_MODE: "timeout" },
        available: true,
        unavailableReason: null,
      },
      iterations: 1,
      timeoutMs: 40,
    });
    assert.equal(result.units[1].status, "timeout");
    assert.equal(result.units[1].samples[0].status, "timeout");
    assert.equal(result.units[1].samples[0].exitCode, null);
    assert.equal(result.units[1].stats, null);
  });
});
