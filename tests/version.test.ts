import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chooseCandidate, parseMooncVersion, toolchainsMatch } from "../scripts/lib/version.js";
import { makeToolchain } from "./helpers.js";

describe("moonc version parsing", () => {
  it("preserves and normalizes the direct moonc -v identity", () => {
    assert.deepEqual(parseMooncVersion("v0.9.0+69d374a17 (2026-04-20)\r\n"), {
      parseStatus: "ok",
      rawVersion: "v0.9.0+69d374a17 (2026-04-20)",
      version: "v0.9.0+69d374a17",
      commit: "69d374a17",
      date: "2026-04-20",
      normalized: "v0.9.0+69d374a17|69d374a17|2026-04-20",
    });
  });

  it("also accepts the prefixed line emitted by moon version --all", () => {
    const parsed = parseMooncVersion(
      "/tmp/moon\nmoonc v0.10.5+5e7afb0c0 (2026-07-27) /tmp/moonc",
    );
    assert.equal(parsed.parseStatus, "ok");
    assert.equal(parsed.version, "v0.10.5+5e7afb0c0");
    assert.equal(parsed.commit, "5e7afb0c0");
    assert.equal(parsed.date, "2026-07-27");
  });

  it("reports partial or changed output as a parse failure", () => {
    const parsed = parseMooncVersion("MoonBit compiler development build");
    assert.equal(parsed.parseStatus, "failed");
    assert.equal(parsed.normalized, null);
  });
});

describe("candidate channel selection", () => {
  it("selects nightly only when stable and pre-release match exactly", () => {
    const stable = makeToolchain("stable", "v0.10.4+aaaaaaa");
    const preRelease = {
      ...makeToolchain("pre-release", "v0.10.4+aaaaaaa"),
      normalized: stable.normalized,
    };
    assert.equal(toolchainsMatch(stable, preRelease), true);
    const selection = chooseCandidate(stable, preRelease);
    assert.equal(selection.selectedChannel, "nightly");
    assert.equal(selection.stableMatchesPreRelease, true);
  });

  it("selects pre-release when its identity differs", () => {
    const selection = chooseCandidate(makeToolchain("stable"), makeToolchain("pre-release"));
    assert.equal(selection.selectedChannel, "pre-release");
    assert.equal(selection.stableMatchesPreRelease, false);
    assert.equal(selection.reason, "pre-release-differs");
  });

  it("does not claim equality when exact parsing failed", () => {
    const stable = makeToolchain("stable");
    const preRelease = {
      ...makeToolchain("pre-release"),
      parseStatus: "failed" as const,
      normalized: null,
    };
    assert.equal(toolchainsMatch(stable, preRelease), null);
    assert.equal(chooseCandidate(stable, preRelease).reason, "version-unavailable");
  });
});
