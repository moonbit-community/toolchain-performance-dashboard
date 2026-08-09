import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  BENCHMARK_COMMAND,
  type Backend,
  type BenchmarkErrorV1,
  type BenchmarkSampleV1,
  type BenchmarkUnitV1,
  type OsId,
  type ToolchainChannel,
  type ToolchainRole,
  type UnitStatus,
} from "../../src/data/types.js";
import { runProcess, summarizeProcessFailure } from "./process.js";
import { calculateStats } from "./statistics.js";

export interface RuntimeToolchain {
  role: ToolchainRole;
  channel: ToolchainChannel;
  moonHome: string;
  moonExecutable: string;
  available: boolean;
  unavailableReason: string | null;
  executableArgsPrefix?: string[];
  extraEnvironment?: NodeJS.ProcessEnv;
}

export interface SamplingOptions {
  os: OsId;
  backend: Backend;
  coreDirectory: string;
  targetRoot: string;
  stable: RuntimeToolchain;
  candidate: RuntimeToolchain;
  startingSequence?: number;
  iterations?: number;
  timeoutMs?: number;
}

export interface SamplingResult {
  units: [BenchmarkUnitV1, BenchmarkUnitV1];
  nextSequence: number;
}

export interface ScheduledSample {
  iteration: number;
  role: ToolchainRole;
}

export function createAlternatingSchedule(
  iterations: number = BENCHMARK_COMMAND.iterations,
): ScheduledSample[] {
  const schedule: ScheduledSample[] = [];
  for (let iteration = 1; iteration <= iterations; iteration += 1) {
    const roles: ToolchainRole[] =
      iteration % 2 === 1 ? ["stable", "candidate"] : ["candidate", "stable"];
    for (const role of roles) schedule.push({ iteration, role });
  }
  return schedule;
}

function deriveUnitStatus(samples: readonly BenchmarkSampleV1[], expected: number): UnitStatus {
  if (samples.some((sample) => sample.status === "timeout")) return "timeout";
  if (samples.some((sample) => sample.status === "failed")) return "failed";
  return samples.length === expected ? "ok" : "unavailable";
}

function firstError(samples: readonly BenchmarkSampleV1[]): BenchmarkErrorV1 | null {
  const sample = samples.find((value) => value.status !== "ok");
  if (!sample) return null;
  return {
    iteration: sample.iteration,
    exitCode: sample.exitCode,
    summary: sample.errorSummary ?? `Sample ${sample.iteration} did not complete`,
  };
}

function unavailableUnit(
  os: OsId,
  backend: Backend,
  toolchain: RuntimeToolchain,
): BenchmarkUnitV1 {
  return {
    id: `${os}/${backend}/${toolchain.role}`,
    os,
    backend,
    role: toolchain.role,
    channel: toolchain.channel,
    status: "unavailable",
    samples: [],
    stats: null,
    error: {
      iteration: null,
      exitCode: null,
      summary: toolchain.unavailableReason ?? `${toolchain.channel} toolchain is unavailable`,
    },
  };
}

export async function sampleBackendPair(options: SamplingOptions): Promise<SamplingResult> {
  const iterations = options.iterations ?? BENCHMARK_COMMAND.iterations;
  const timeoutMs = options.timeoutMs ?? BENCHMARK_COMMAND.timeoutMs;
  const byRole: Record<ToolchainRole, BenchmarkSampleV1[]> = {
    stable: [],
    candidate: [],
  };
  const runtimes: Record<ToolchainRole, RuntimeToolchain> = {
    stable: options.stable,
    candidate: options.candidate,
  };
  let sequence = options.startingSequence ?? 1;

  for (const scheduled of createAlternatingSchedule(iterations)) {
    const runtime = runtimes[scheduled.role];
    if (!runtime.available) continue;
    const targetDirId = [
      options.os,
      options.backend,
      scheduled.role,
      String(scheduled.iteration),
      String(sequence),
      randomUUID().slice(0, 8),
    ].join("-");
    const targetDirectory = path.join(options.targetRoot, targetDirId);
    await rm(targetDirectory, { recursive: true, force: true });

    const args = [
      ...(runtime.executableArgsPrefix ?? []),
      "check",
      "--target",
      options.backend,
      "--target-dir",
      targetDirectory,
      "--frozen",
      "--quiet",
    ];
    const startedAt = new Date().toISOString();
    const result = await runProcess(runtime.moonExecutable, args, {
      cwd: options.coreDirectory,
      timeoutMs,
      env: {
        ...process.env,
        ...runtime.extraEnvironment,
        MOON_HOME: runtime.moonHome,
        MOONC_RC_CONVENTION: "borrow",
        MOONBIT_BENCHMARK_ROLE: runtime.role,
        PATH: `${path.dirname(runtime.moonExecutable)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    const sample: BenchmarkSampleV1 = {
      iteration: scheduled.iteration,
      sequence,
      role: runtime.role,
      channel: runtime.channel,
      targetDirId,
      startedAt,
      durationMs: result.durationMs,
      status: result.status,
      exitCode: result.exitCode,
      errorSummary: result.status === "ok" ? null : summarizeProcessFailure(result),
    };
    byRole[runtime.role].push(sample);
    sequence += 1;
  }

  const makeUnit = (runtime: RuntimeToolchain): BenchmarkUnitV1 => {
    if (!runtime.available) return unavailableUnit(options.os, options.backend, runtime);
    const samples = byRole[runtime.role];
    const status = deriveUnitStatus(samples, iterations);
    return {
      id: `${options.os}/${options.backend}/${runtime.role}`,
      os: options.os,
      backend: options.backend,
      role: runtime.role,
      channel: runtime.channel,
      status,
      samples,
      stats:
        status === "ok" ? calculateStats(samples.map((sample) => sample.durationMs)) : null,
      error: firstError(samples),
    };
  };

  return {
    units: [makeUnit(options.stable), makeUnit(options.candidate)],
    nextSequence: sequence,
  };
}
