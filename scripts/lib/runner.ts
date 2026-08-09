import os from "node:os";
import type { OsId, RunnerInfoV1 } from "../../src/data/types.js";

const RUNNER_LABELS: Record<OsId, string> = {
  ubuntu: "ubuntu-24.04",
  windows: "windows-2025",
  macos: "macos-15",
};

export function collectRunnerInfo(osId: OsId): RunnerInfoV1 {
  const cpus = os.cpus();
  const firstCpu = cpus[0];
  return {
    os: osId,
    label: RUNNER_LABELS[osId],
    architecture: process.arch,
    name: process.env.RUNNER_NAME ?? os.hostname(),
    environment: process.env.RUNNER_ENVIRONMENT ?? "local",
    imageOs: process.env.ImageOS ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    cpu: {
      model: firstCpu?.model.trim() || "Unknown CPU",
      logicalCores: cpus.length,
      speedMHz: firstCpu?.speed ?? null,
    },
  };
}
