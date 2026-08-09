import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";

export interface ProcessResult {
  status: "ok" | "failed" | "timeout";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  spawnError: string | null;
}

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes?: number;
}

function appendLimited(current: string, chunk: Buffer, limit: number): string {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) <= limit) return next;
  return Buffer.from(next).subarray(-limit).toString("utf8");
}

export function runProcess(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const maxOutputBytes = options.maxOutputBytes ?? 64 * 1024;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let spawnError: string | null = null;

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk, maxOutputBytes);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk, maxOutputBytes);
    });

    const killTree = (signal: NodeJS.Signals): void => {
      if (process.platform === "win32") {
        if (child.pid !== undefined) {
          const killer = spawn(
            "taskkill",
            ["/pid", String(child.pid), "/t", "/f"],
            { stdio: "ignore", windowsHide: true },
          );
          killer.on("error", () => {
            if (!settled) child.kill();
          });
          killer.on("close", (code) => {
            if (code !== 0 && !settled) child.kill();
          });
          killer.unref();
        }
        return;
      }
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {
          // The process may already have exited or may not own a process group.
        }
      }
      child.kill(signal);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      killTree("SIGTERM");
      setTimeout(() => {
        if (!settled && process.platform !== "win32") killTree("SIGKILL");
      }, 2_000).unref();
    }, options.timeoutMs);
    timeout.unref();

    child.on("error", (error) => {
      spawnError = error.message;
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const durationMs = performance.now() - started;
      resolve({
        status: timedOut ? "timeout" : code === 0 && spawnError === null ? "ok" : "failed",
        exitCode: timedOut ? null : code,
        stdout,
        stderr,
        durationMs,
        spawnError,
      });
    });
  });
}

export function summarizeProcessFailure(result: ProcessResult, maxLength = 2_000): string {
  const parts = [result.spawnError, result.stderr.trim(), result.stdout.trim()].filter(
    (value): value is string => Boolean(value),
  );
  const fallback =
    result.status === "timeout"
      ? "Process exceeded its timeout"
      : `Process exited with code ${String(result.exitCode)}`;
  const summary = parts.join("\n").trim() || fallback;
  return summary.length <= maxLength ? summary : `${summary.slice(0, maxLength - 1)}…`;
}
