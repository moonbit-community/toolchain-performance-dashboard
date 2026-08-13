import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parseRunIndexJson } from "../src/data/validation.js";
import {
  DEFAULT_FILTERS,
  buildDeltaSeries,
  buildMedianSeries,
  latestMatrix,
} from "../src/dashboard/model.js";
import { renderDashboard } from "../src/dashboard/render.js";
import {
  emptyIndexFixture,
  normalIndexFixture,
  partialIndexFixture,
  switchingIndexFixture,
} from "./fixtures/dashboard-fixtures.js";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const now = Date.parse("2026-08-10T00:00:00.000Z");

describe("dashboard data fixtures", () => {
  it("accepts a valid empty history", async () => {
    const parsed = parseRunIndexJson(await readFile(fixture("index-empty.json"), "utf8"));
    assert.deepEqual(parsed, emptyIndexFixture);
    assert.match(
      renderDashboard(parsed, null, null, DEFAULT_FILTERS, [], []),
      /No benchmark runs yet/,
    );
  });

  it("builds the complete latest matrix", () => {
    const cells = latestMatrix(normalIndexFixture.runs[0]);
    assert.equal(cells.length, 12);
    assert.equal(cells.every((cell) => cell.status === "ok"), true);
    assert.equal(cells.some((cell) => cell.deltaPercent! < 0), true);
    assert.equal(cells.some((cell) => cell.deltaPercent! > 0), true);
    const html = renderDashboard(
      normalIndexFixture,
      null,
      "loading",
      DEFAULT_FILTERS,
      buildMedianSeries(normalIndexFixture, DEFAULT_FILTERS, now),
      buildDeltaSeries(normalIndexFixture, DEFAULT_FILTERS, now),
    );
    assert.match(html, /<h1 id="matrix-title">OS × backend delta<\/h1>/);
    assert.match(html, /id="heatmap-chart"/);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1);
    assert.ok(html.indexOf("matrix-title") < html.indexOf("trends-title"));
  });

  it("keeps pre-release and nightly in separate trend series", () => {
    const filters = {
      os: "ubuntu" as const,
      backend: "wasm" as const,
      channel: "all" as const,
      range: "30" as const,
    };
    const candidates = buildMedianSeries(switchingIndexFixture, filters, now).filter(
      (series) => series.role === "candidate",
    );
    assert.equal(candidates.length, 2);
    assert.deepEqual(new Set(candidates.map((series) => series.channel)),
      new Set(["pre-release", "nightly"]),
    );
    assert.equal(candidates.every((series) => series.points.length === 1), true);
    assert.equal(buildDeltaSeries(switchingIndexFixture, filters, now).length, 2);
  });

  it("retains partial failures without inventing a delta", () => {
    const failed = latestMatrix(partialIndexFixture.runs[0]).find(
      (cell) => cell.os === "windows" && cell.backend === "native",
    );
    assert.equal(failed?.status, "timeout");
    assert.equal(failed?.stableMedianMs, null);
    assert.equal(failed?.candidateMedianMs, null);
    assert.equal(failed?.deltaPercent, null);
    assert.match(
      renderDashboard(partialIndexFixture, null, "loading", DEFAULT_FILTERS, [], []),
      /timeout/,
    );
  });

  it("renders an explicit exact-version parsing failure", () => {
    const broken = structuredClone(normalIndexFixture);
    broken.runs[0].toolchains[0].stable.version = null;
    broken.runs[0].toolchains[0].stable.parseStatus = "failed";
    broken.runs[0].toolchains[0].stable.normalized = null;
    broken.runs[0].toolchains[0].stable.errorSummary = "Unexpected moonc output";
    assert.match(
      renderDashboard(broken, null, "loading", DEFAULT_FILTERS, [], []),
      /Version parse failed/,
    );
  });

  it("reports corrupted JSON as a validation error", async () => {
    const contents = await readFile(fixture("index-corrupt.json"), "utf8");
    assert.throws(() => parseRunIndexJson(contents), /not valid JSON/i);
  });
});
