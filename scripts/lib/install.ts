import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CandidateSelectionV1,
  ToolchainChannel,
  ToolchainPairV1,
  ToolchainVersionV1,
} from "../../src/data/types.js";
import type { OsId } from "../../src/data/types.js";
import { runProcess, summarizeProcessFailure } from "./process.js";
import { chooseCandidate, parseMooncVersion, unavailableToolchain } from "./version.js";

const UNIX_INSTALLER = "https://cli.moonbitlang.com/install/unix.sh";
const WINDOWS_INSTALLER = "https://cli.moonbitlang.com/install/powershell.ps1";

export interface InstalledToolchain {
  info: ToolchainVersionV1;
  moonHome: string;
  moonExecutable: string;
}

export interface InstalledToolchainPair {
  stable: InstalledToolchain;
  preRelease: InstalledToolchain;
  candidate: InstalledToolchain;
  selection: CandidateSelectionV1;
  published: ToolchainPairV1;
}

interface InstallOptions {
  channel: ToolchainChannel;
  requestedVersion: ToolchainVersionV1["requestedVersion"];
  moonHome: string;
  tempDirectory: string;
  platform?: NodeJS.Platform;
  fetcher?: typeof fetch;
}

function executablePath(moonHome: string, name: "moon" | "moonc", platform: NodeJS.Platform): string {
  return path.join(moonHome, "bin", platform === "win32" ? `${name}.exe` : name);
}

export async function installToolchain(options: InstallOptions): Promise<InstalledToolchain> {
  const platform = options.platform ?? process.platform;
  const fetcher = options.fetcher ?? fetch;
  const moonExecutable = executablePath(options.moonHome, "moon", platform);
  const compilerExecutable = executablePath(options.moonHome, "moonc", platform);

  try {
    await mkdir(options.tempDirectory, { recursive: true });
    await mkdir(options.moonHome, { recursive: true });
    const installerUrl = platform === "win32" ? WINDOWS_INSTALLER : UNIX_INSTALLER;
    const response = await fetcher(installerUrl);
    if (!response.ok) {
      throw new Error(`Installer download returned HTTP ${response.status}`);
    }
    const script = await response.text();
    const extension = platform === "win32" ? "ps1" : "sh";
    const installerPath = path.join(
      options.tempDirectory,
      `install-${options.requestedVersion}.${extension}`,
    );
    await writeFile(installerPath, script, "utf8");

    const command = platform === "win32" ? "pwsh" : "bash";
    const args =
      platform === "win32"
        ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", installerPath]
        : [installerPath, options.requestedVersion];
    const installResult = await runProcess(command, args, {
      timeoutMs: 10 * 60_000,
      env: {
        ...process.env,
        MOON_HOME: options.moonHome,
        MOONBIT_INSTALL_VERSION: options.requestedVersion,
      },
    });
    if (installResult.status !== "ok") {
      const summary = summarizeProcessFailure(installResult);
      return {
        info: unavailableToolchain(options.channel, options.requestedVersion, summary),
        moonHome: options.moonHome,
        moonExecutable,
      };
    }

    const versionResult = await runProcess(compilerExecutable, ["-v"], {
      timeoutMs: 30_000,
      env: {
        ...process.env,
        MOON_HOME: options.moonHome,
        PATH: `${path.dirname(moonExecutable)}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    });
    const rawVersion = `${versionResult.stdout}\n${versionResult.stderr}`.trim();
    if (versionResult.status !== "ok") {
      return {
        info: unavailableToolchain(
          options.channel,
          options.requestedVersion,
          summarizeProcessFailure(versionResult),
        ),
        moonHome: options.moonHome,
        moonExecutable,
      };
    }

    const parsed = parseMooncVersion(rawVersion);
    return {
      info: {
        channel: options.channel,
        requestedVersion: options.requestedVersion,
        installationStatus: "ok",
        ...parsed,
        errorSummary:
          parsed.parseStatus === "failed"
            ? "moonc -v completed, but its exact version, commit, or date could not be parsed"
            : null,
      },
      moonHome: options.moonHome,
      moonExecutable,
    };
  } catch (error) {
    return {
      info: unavailableToolchain(
        options.channel,
        options.requestedVersion,
        error instanceof Error ? error.message : String(error),
      ),
      moonHome: options.moonHome,
      moonExecutable,
    };
  }
}

export async function installComparisonToolchains(
  os: OsId,
  rootDirectory: string,
): Promise<InstalledToolchainPair> {
  const installTemp = path.join(rootDirectory, "installers");
  const stable = await installToolchain({
    channel: "stable",
    requestedVersion: "latest",
    moonHome: path.join(rootDirectory, "stable"),
    tempDirectory: installTemp,
  });
  const preRelease = await installToolchain({
    channel: "pre-release",
    requestedVersion: "pre-release",
    moonHome: path.join(rootDirectory, "pre-release"),
    tempDirectory: installTemp,
  });
  const selection = chooseCandidate(stable.info, preRelease.info);
  const candidate =
    selection.selectedChannel === "nightly"
      ? await installToolchain({
          channel: "nightly",
          requestedVersion: "nightly",
          moonHome: path.join(rootDirectory, "nightly"),
          tempDirectory: installTemp,
        })
      : preRelease;

  return {
    stable,
    preRelease,
    candidate,
    selection,
    published: {
      os,
      stable: stable.info,
      preRelease: preRelease.info,
      candidate: candidate.info,
      selection,
    },
  };
}
