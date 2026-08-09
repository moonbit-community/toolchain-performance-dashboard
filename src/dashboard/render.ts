import {
  BACKENDS,
  CANDIDATE_CHANNELS,
  OS_IDS,
  type BenchmarkRunV1,
  type RunIndexV1,
  type RunSummaryV1,
  type ToolchainPairV1,
} from "../data/types.js";
import {
  BACKEND_LABELS,
  OS_LABELS,
  latestMatrix,
  type DashboardFilters,
  type TrendSeries,
} from "./model.js";
import {
  deltaMeaning,
  escapeHtml,
  formatDelta,
  formatDuration,
  formatLocal,
  formatUtc,
  shortSha,
  statusBadge,
  toolchainLabel,
} from "./format.js";

function selected(value: string, current: string): string {
  return value === current ? " selected" : "";
}

function option(value: string, label: string, current: string): string {
  return `<option value="${escapeHtml(value)}"${selected(value, current)}>${escapeHtml(label)}</option>`;
}

function renderHeader(): string {
  return `
    <header class="site-header">
      <a class="brand" href="./" aria-label="MoonBit Toolchain Performance home">
        <span class="brand-mark" aria-hidden="true"><span></span></span>
        <span>
          <strong>MoonBit</strong>
          <small>Toolchain performance</small>
        </span>
      </a>
      <nav aria-label="Project links">
        <a href="https://github.com/moonbit-community/toolchain-performance-dashboard" target="_blank" rel="noreferrer">Source <span aria-hidden="true">↗</span></a>
        <a href="https://github.com/moonbitlang/core/commit/50c136025f4385ab131d82e68d79ebdd46ce50c2" target="_blank" rel="noreferrer">Core baseline <span aria-hidden="true">↗</span></a>
      </nav>
    </header>`;
}

function renderProtocol(): string {
  return `
    <section class="protocol" aria-labelledby="protocol-title">
      <div>
        <p class="eyebrow">Benchmark protocol</p>
        <h2 id="protocol-title">A fixed source, a moving toolchain</h2>
        <p>Every run checks the same core revision with clean output directories. Five un-warmed samples are paired and alternated on the same runner.</p>
      </div>
      <dl class="protocol-grid">
        <div><dt>Source</dt><dd><code>core@50c13602</code></dd></div>
        <div><dt>Backends</dt><dd>Wasm · Wasm GC · JS · Native</dd></div>
        <div><dt>Samples</dt><dd>5 per toolchain and cell</dd></div>
        <div><dt>Schedule</dt><dd>Daily · 02:00 UTC</dd></div>
      </dl>
    </section>`;
}

export function renderLoading(): string {
  return `
    ${renderHeader()}
    <main id="main-content" class="page-shell">
      <section class="hero hero--loading" aria-live="polite">
        <p class="eyebrow">Daily cross-platform signal</p>
        <h1>Reading benchmark history…</h1>
        <div class="loading-bar" aria-hidden="true"><span></span></div>
      </section>
      ${renderProtocol()}
    </main>`;
}

export function renderFatalError(message: string): string {
  return `
    ${renderHeader()}
    <main id="main-content" class="page-shell">
      <section class="state-panel state-panel--error" role="alert">
        <span class="state-glyph" aria-hidden="true">×</span>
        <p class="eyebrow">Data unavailable</p>
        <h1>The benchmark history could not be read.</h1>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="button" id="retry-load">Try again</button>
      </section>
      ${renderProtocol()}
    </main>`;
}

function renderEmpty(index: RunIndexV1): string {
  return `
    ${renderHeader()}
    <main id="main-content" class="page-shell">
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Daily cross-platform signal</p>
          <h1>Performance history starts with the first scheduled run.</h1>
          <p class="lede">The dashboard is ready. GitHub Actions will compare stable with pre-release—or nightly when pre-release matches stable—across three operating systems and four backends.</p>
        </div>
        <div class="empty-orbit" aria-hidden="true"><span></span><i></i></div>
      </section>
      <section class="state-panel">
        <span class="state-glyph" aria-hidden="true">○</span>
        <p class="eyebrow">No benchmark runs yet</p>
        <h2>Waiting for data</h2>
        <p>The index is valid and empty. Trigger the Benchmark workflow manually or wait for 02:00 UTC.</p>
        <small>Index generated ${escapeHtml(formatUtc(index.generatedAt))}</small>
      </section>
      ${renderProtocol()}
    </main>
    ${renderFooter()}`;
}

function versionMetadata(toolchain: ToolchainPairV1): string {
  const items = [toolchain.stable, toolchain.candidate];
  return items
    .map(
      (item) => `
        <div class="version-block">
          <span>${escapeHtml(item.channel)}</span>
          <strong>${escapeHtml(toolchainLabel(item))}</strong>
          <small>${
            item.parseStatus === "ok"
              ? `${escapeHtml(item.commit ?? "")} · ${escapeHtml(item.date ?? "")}`
              : escapeHtml(item.errorSummary ?? "Exact version unavailable")
          }</small>
        </div>`,
    )
    .join("");
}

function renderOverview(summary: RunSummaryV1): string {
  const channels = [...new Set(summary.toolchains.map((pair) => pair.candidate.channel))];
  const best = summary.comparisons
    .filter((item) => item.deltaPercent !== null)
    .sort((left, right) => left.deltaPercent! - right.deltaPercent!)[0];
  const worst = summary.comparisons
    .filter((item) => item.deltaPercent !== null)
    .sort((left, right) => right.deltaPercent! - left.deltaPercent!)[0];
  return `
    <section class="hero hero--latest" aria-labelledby="page-title">
      <div class="hero-copy">
        <p class="eyebrow"><span class="live-dot" aria-hidden="true"></span> Daily cross-platform signal</p>
        <h1 id="page-title">Is the next MoonBit toolchain faster?</h1>
        <p class="lede">Stable versus <strong>${escapeHtml(channels.join(" / "))}</strong>, measured against one immutable core revision. Negative deltas mean the candidate finished sooner.</p>
        <div class="timestamp-pair">
          <span><b>UTC</b> <time datetime="${escapeHtml(summary.completedAt)}">${escapeHtml(formatUtc(summary.completedAt))}</time></span>
          <span><b>Local</b> <time datetime="${escapeHtml(summary.completedAt)}">${escapeHtml(formatLocal(summary.completedAt))}</time></span>
        </div>
      </div>
      <div class="hero-status">
        <span class="hero-status-label">Latest run</span>
        ${statusBadge(summary.health.status)}
        <strong>${summary.health.okComparisons}<small> / ${summary.health.totalComparisons}</small></strong>
        <span>comparable cells</span>
        <a href="${escapeHtml(summary.workflow.url)}" target="_blank" rel="noreferrer">Open workflow <span aria-hidden="true">↗</span></a>
      </div>
    </section>
    <section class="metric-strip" aria-label="Latest run highlights">
      <article>
        <span>Core revision</span>
        <a href="https://github.com/moonbitlang/core/commit/${escapeHtml(summary.coreSha)}" target="_blank" rel="noreferrer"><code>${escapeHtml(shortSha(summary.coreSha))}</code></a>
        <small>Fixed across all runs</small>
      </article>
      <article>
        <span>Best candidate result</span>
        <strong class="delta delta--good">${formatDelta(best?.deltaPercent ?? null)}</strong>
        <small>${best ? `${OS_LABELS[best.os]} · ${BACKEND_LABELS[best.backend]}` : "No valid comparison"}</small>
      </article>
      <article>
        <span>Largest regression</span>
        <strong class="delta delta--bad">${formatDelta(worst?.deltaPercent ?? null)}</strong>
        <small>${worst ? `${OS_LABELS[worst.os]} · ${BACKEND_LABELS[worst.backend]}` : "No valid comparison"}</small>
      </article>
      <article>
        <span>Unit health</span>
        <strong>${summary.health.okUnits}<small> / ${summary.health.totalUnits}</small></strong>
        <small>${summary.health.parseFailures} version parse failure${summary.health.parseFailures === 1 ? "" : "s"}</small>
      </article>
    </section>`;
}

function renderVersions(summary: RunSummaryV1): string {
  return `
    <section class="section-block" aria-labelledby="versions-title">
      <div class="section-heading">
        <div><p class="eyebrow">Exact inputs</p><h2 id="versions-title">Toolchain pair by runner</h2></div>
        <p>Endpoints are resolved independently on each VM and preserved verbatim.</p>
      </div>
      <div class="version-grid">
        ${summary.toolchains
          .map(
            (pair) => `
              <article class="version-card">
                <header><strong>${escapeHtml(OS_LABELS[pair.os])}</strong><span>${escapeHtml(pair.selection.selectedChannel)}</span></header>
                ${versionMetadata(pair)}
                <footer>${
                  pair.selection.reason === "pre-release-matches-stable"
                    ? "Pre-release matched stable, so nightly was selected."
                    : pair.selection.reason === "pre-release-differs"
                      ? "Pre-release differed from stable and was selected."
                      : "Exact version comparison was unavailable; pre-release was retained."
                }</footer>
              </article>`,
          )
          .join("")}
      </div>
    </section>`;
}

function renderMatrix(summary: RunSummaryV1): string {
  const cells = latestMatrix(summary);
  return `
    <section class="section-block" aria-labelledby="matrix-title">
      <div class="section-heading">
        <div><p class="eyebrow">Latest comparison</p><h2 id="matrix-title">OS × backend delta</h2></div>
        <div class="legend" aria-label="Delta legend"><span class="legend-fast">Candidate faster</span><span>Even</span><span class="legend-slow">Candidate slower</span></div>
      </div>
      <div class="chart-card chart-card--wide">
        <div id="heatmap-chart" class="chart chart--heatmap" role="img" aria-label="Latest candidate versus stable performance matrix"></div>
        <details class="chart-summary">
          <summary>Text version of the matrix</summary>
          <div class="table-scroll">
            <table>
              <thead><tr><th scope="col">Runner</th><th scope="col">Backend</th><th scope="col">Channel</th><th scope="col">Status</th><th scope="col">Stable</th><th scope="col">Candidate</th><th scope="col">Delta</th></tr></thead>
              <tbody>
                ${cells
                  .map(
                    (cell) => `<tr>
                      <th scope="row">${escapeHtml(OS_LABELS[cell.os])}</th>
                      <td>${escapeHtml(BACKEND_LABELS[cell.backend])}</td>
                      <td>${escapeHtml(cell.candidateChannel)}</td>
                      <td>${statusBadge(cell.status)}</td>
                      <td>${formatDuration(cell.stableMedianMs)}</td>
                      <td>${formatDuration(cell.candidateMedianMs)}</td>
                      <td><strong>${formatDelta(cell.deltaPercent)}</strong><small>${escapeHtml(deltaMeaning(cell.deltaPercent))}</small></td>
                    </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>`;
}

function renderFilters(filters: DashboardFilters): string {
  return `
    <form class="filters" id="trend-filters" aria-label="Trend filters">
      <label><span>Runner</span><select name="os">
        ${option("all", "All runners", filters.os)}
        ${OS_IDS.map((os) => option(os, OS_LABELS[os], filters.os)).join("")}
      </select></label>
      <label><span>Backend</span><select name="backend">
        ${option("all", "All backends", filters.backend)}
        ${BACKENDS.map((backend) => option(backend, BACKEND_LABELS[backend], filters.backend)).join("")}
      </select></label>
      <label><span>Candidate</span><select name="channel">
        ${option("all", "All channels", filters.channel)}
        ${CANDIDATE_CHANNELS.map((channel) => option(channel, channel, filters.channel)).join("")}
      </select></label>
      <label><span>Range</span><select name="range">
        ${option("7", "Last 7 days", filters.range)}
        ${option("30", "Last 30 days", filters.range)}
        ${option("90", "Last 90 days", filters.range)}
        ${option("all", "All history", filters.range)}
      </select></label>
    </form>`;
}

function trendText(series: readonly TrendSeries[], metric: "duration" | "delta"): string {
  if (series.length === 0) return `<p>No successful points match these filters.</p>`;
  return `<ul>${series
    .map((item) => {
      const point = item.points[item.points.length - 1];
      return `<li><strong>${escapeHtml(item.name)}</strong>: ${
        metric === "duration" ? formatDuration(point?.value ?? null) : formatDelta(point?.value ?? null)
      } across ${item.points.length} point${item.points.length === 1 ? "" : "s"}</li>`;
    })
    .join("")}</ul>`;
}

function renderTrends(
  filters: DashboardFilters,
  medianSeries: readonly TrendSeries[],
  deltaSeries: readonly TrendSeries[],
): string {
  return `
    <section class="section-block" aria-labelledby="trends-title">
      <div class="section-heading section-heading--stack">
        <div><p class="eyebrow">History</p><h2 id="trends-title">Median and delta trends</h2></div>
        <p>Candidate lines are split by channel. A pre-release to nightly transition is never joined into one series.</p>
      </div>
      ${renderFilters(filters)}
      <div class="trend-grid">
        <article class="chart-card">
          <header><div><span>Absolute time</span><h3>Median duration</h3></div><small>Lower is better</small></header>
          ${medianSeries.length > 0 ? `<div id="median-chart" class="chart chart--trend" role="img" aria-label="Median benchmark duration trend"></div>` : `<div class="chart-empty">No median data for this selection.</div>`}
          <details class="chart-summary"><summary>Text summary</summary>${trendText(medianSeries, "duration")}</details>
        </article>
        <article class="chart-card">
          <header><div><span>Relative change</span><h3>Candidate delta</h3></div><small>Negative is faster</small></header>
          ${deltaSeries.length > 0 ? `<div id="delta-chart" class="chart chart--trend" role="img" aria-label="Candidate performance delta trend"></div>` : `<div class="chart-empty">No delta data for this selection.</div>`}
          <details class="chart-summary"><summary>Text summary</summary>${trendText(deltaSeries, "delta")}</details>
        </article>
      </div>
    </section>`;
}

function sampleList(unit: BenchmarkRunV1["units"][number]): string {
  if (unit.samples.length === 0) return "—";
  return unit.samples
    .map(
      (sample) =>
        `<span class="sample sample--${sample.status}" title="Iteration ${sample.iteration}, sequence ${sample.sequence}">${
          sample.status === "ok" ? formatDuration(sample.durationMs) : escapeHtml(sample.status)
        }</span>`,
    )
    .join("");
}

function renderRunDetails(run: BenchmarkRunV1): string {
  const failures = run.units.filter((unit) => unit.status !== "ok");
  return `
    <section class="section-block" aria-labelledby="details-title">
      <div class="section-heading">
        <div><p class="eyebrow">Evidence</p><h2 id="details-title">Raw samples and runner details</h2></div>
        <p>Cleanup happens before timing; every badge is one independent process.</p>
      </div>
      <div class="detail-card">
        <div class="table-scroll">
          <table class="sample-table">
            <thead><tr><th scope="col">Runner</th><th scope="col">Backend</th><th scope="col">Toolchain</th><th scope="col">Status</th><th scope="col">Five samples</th><th scope="col">Min / median / max</th></tr></thead>
            <tbody>
              ${run.units
                .map(
                  (unit) => `<tr>
                    <th scope="row">${escapeHtml(OS_LABELS[unit.os])}</th>
                    <td>${escapeHtml(BACKEND_LABELS[unit.backend])}</td>
                    <td><strong>${escapeHtml(unit.role)}</strong><small>${escapeHtml(unit.channel)}</small></td>
                    <td>${statusBadge(unit.status)}</td>
                    <td><div class="samples">${sampleList(unit)}</div></td>
                    <td class="stats">${
                      unit.stats
                        ? `${formatDuration(unit.stats.minMs)} <b>/</b> ${formatDuration(unit.stats.medianMs)} <b>/</b> ${formatDuration(unit.stats.maxMs)}`
                        : "—"
                    }</td>
                  </tr>`,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="detail-grid">
        <article class="detail-card">
          <h3>Runner inventory</h3>
          <div class="table-scroll"><table>
            <thead><tr><th scope="col">Image</th><th scope="col">Architecture</th><th scope="col">CPU</th><th scope="col">Image version</th></tr></thead>
            <tbody>${run.runners
              .map(
                (runner) => `<tr><th scope="row">${escapeHtml(runner.label)}</th><td>${escapeHtml(runner.architecture)}</td><td>${escapeHtml(runner.cpu.model)}<small>${runner.cpu.logicalCores} logical cores</small></td><td>${escapeHtml(runner.imageVersion ?? "Not reported")}</td></tr>`,
              )
              .join("")}</tbody>
          </table></div>
        </article>
        <article class="detail-card command-card">
          <h3>Command contract</h3>
          <code>moon ${escapeHtml(run.command.argsTemplate.join(" "))}</code>
          <dl>
            <div><dt>Environment</dt><dd><code>MOONC_RC_CONVENTION=borrow</code></dd></div>
            <div><dt>Timeout</dt><dd>${run.command.timeoutMs / 1_000} seconds per process</dd></div>
            <div><dt>Ordering</dt><dd>Alternating first toolchain, no warm-up</dd></div>
          </dl>
        </article>
      </div>
      ${
        failures.length > 0
          ? `<details class="failure-panel" open><summary>${failures.length} failed, timed out, or unavailable unit${failures.length === 1 ? "" : "s"}</summary><ul>${failures
              .map(
                (unit) => `<li><strong>${escapeHtml(`${unit.os}/${unit.backend}/${unit.role}`)}</strong> ${statusBadge(unit.status)}<pre>${escapeHtml(unit.error?.summary ?? "No error detail was recorded")}</pre></li>`,
              )
              .join("")}</ul></details>`
          : `<div class="success-panel"><span aria-hidden="true">✓</span><p><strong>All 24 units completed.</strong> Every comparison contains five stable and five candidate samples.</p></div>`
      }
    </section>`;
}

function renderDetailState(detailState: "loading" | string): string {
  return `
    <section class="section-block" aria-labelledby="details-title">
      <div class="section-heading"><div><p class="eyebrow">Evidence</p><h2 id="details-title">Raw samples and runner details</h2></div></div>
      <div class="state-panel ${detailState === "loading" ? "" : "state-panel--error"}" ${detailState === "loading" ? "aria-live=\"polite\"" : "role=\"alert\""}>
        <span class="state-glyph" aria-hidden="true">${detailState === "loading" ? "…" : "!"}</span>
        <h3>${detailState === "loading" ? "Loading the latest run file" : "Latest raw details unavailable"}</h3>
        ${detailState === "loading" ? "" : `<p>${escapeHtml(detailState)}</p>`}
      </div>
    </section>`;
}

function renderFooter(): string {
  return `
    <footer class="site-footer">
      <p>Measured by GitHub-hosted runners. Results describe these shared VMs, not every machine.</p>
      <p>Schema V1 · <a href="./data/index.json">Static JSON index</a></p>
    </footer>`;
}

export function renderDashboard(
  index: RunIndexV1,
  run: BenchmarkRunV1 | null,
  detailState: "loading" | string | null,
  filters: DashboardFilters,
  medianSeries: readonly TrendSeries[],
  deltaSeries: readonly TrendSeries[],
): string {
  if (index.runs.length === 0) return renderEmpty(index);
  const latest = index.runs[0];
  return `
    ${renderHeader()}
    <main id="main-content" class="page-shell">
      ${renderOverview(latest)}
      ${renderVersions(latest)}
      ${renderMatrix(latest)}
      ${renderTrends(filters, medianSeries, deltaSeries)}
      ${run ? renderRunDetails(run) : renderDetailState(detailState ?? "Raw run was not loaded")}
      ${renderProtocol()}
    </main>
    ${renderFooter()}`;
}
