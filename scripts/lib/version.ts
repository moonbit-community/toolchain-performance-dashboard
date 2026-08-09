import type {
  CandidateSelectionV1,
  ToolchainChannel,
  ToolchainVersionV1,
} from "../../src/data/types.js";

export interface ParsedMooncVersion {
  parseStatus: "ok" | "failed";
  rawVersion: string;
  version: string | null;
  commit: string | null;
  date: string | null;
  normalized: string | null;
}

export function parseMooncVersion(raw: string): ParsedMooncVersion {
  const rawVersion = raw.replace(/\r\n/g, "\n").trim();
  const lines = rawVersion
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
  const line =
    lines.find((value) => /\bmoonc(?:\.exe)?\b/i.test(value)) ??
    lines.find((value) => /^v?\d+(?:\.\d+)+(?:[-+][^\s(]+)?\s+\(.*\)$/i);

  if (!line) {
    return {
      parseStatus: "failed",
      rawVersion,
      version: null,
      commit: null,
      date: null,
      normalized: null,
    };
  }

  const versionMatch = /\bmoonc(?:\.exe)?\b/i.test(line)
    ? line.match(/\bmoonc(?:\.exe)?\s+([^\s(]+)/i)
    : line.match(/^([^\s(]+)/);
  const dateMatch = line.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const commitMatch = line.match(/\+([0-9a-f]{7,40})(?:\b|$)/i) ?? line.match(/\(([0-9a-f]{7,40})\b/i);
  const version = versionMatch?.[1] ?? null;
  const commit = commitMatch?.[1]?.toLowerCase() ?? null;
  const date = dateMatch?.[1] ?? null;

  if (!version || !commit || !date) {
    return {
      parseStatus: "failed",
      rawVersion,
      version,
      commit,
      date,
      normalized: null,
    };
  }

  return {
    parseStatus: "ok",
    rawVersion,
    version,
    commit,
    date,
    normalized: `${version.toLowerCase()}|${commit}|${date}`,
  };
}

export function toolchainsMatch(
  stable: ToolchainVersionV1,
  preRelease: ToolchainVersionV1,
): boolean | null {
  if (
    stable.installationStatus !== "ok" ||
    preRelease.installationStatus !== "ok" ||
    stable.parseStatus !== "ok" ||
    preRelease.parseStatus !== "ok" ||
    stable.normalized === null ||
    preRelease.normalized === null
  ) {
    return null;
  }
  return stable.normalized === preRelease.normalized;
}

export function chooseCandidate(
  stable: ToolchainVersionV1,
  preRelease: ToolchainVersionV1,
): CandidateSelectionV1 {
  const matches = toolchainsMatch(stable, preRelease);
  if (matches === true) {
    return {
      selectedChannel: "nightly",
      stableMatchesPreRelease: true,
      reason: "pre-release-matches-stable",
    };
  }
  if (matches === false) {
    return {
      selectedChannel: "pre-release",
      stableMatchesPreRelease: false,
      reason: "pre-release-differs",
    };
  }
  return {
    selectedChannel: "pre-release",
    stableMatchesPreRelease: null,
    reason: "version-unavailable",
  };
}

export function unavailableToolchain(
  channel: ToolchainChannel,
  requestedVersion: ToolchainVersionV1["requestedVersion"],
  errorSummary: string,
): ToolchainVersionV1 {
  return {
    channel,
    requestedVersion,
    installationStatus: "unavailable",
    parseStatus: "failed",
    rawVersion: "",
    version: null,
    commit: null,
    date: null,
    normalized: null,
    errorSummary,
  };
}
