import "./styles.css";
import type { EChartsType } from "echarts/core";
import type { BenchmarkRunV1, RunIndexV1 } from "./data/types.js";
import { loadBenchmarkRun, loadRunIndex } from "./data/load.js";
import {
  DEFAULT_FILTERS,
  buildDeltaSeries,
  buildMedianSeries,
  latestMatrix,
  type DashboardFilters,
} from "./dashboard/model.js";
import {
  renderDashboard,
  renderFatalError,
  renderLoading,
} from "./dashboard/render.js";

function requireApp(): HTMLDivElement {
  const element = document.querySelector<HTMLDivElement>("#app");
  if (!element) throw new Error("#app element is missing");
  return element;
}

const app = requireApp();

let index: RunIndexV1 | null = null;
let latestRun: BenchmarkRunV1 | null = null;
let detailState: "loading" | string | null = null;
let filters: DashboardFilters = { ...DEFAULT_FILTERS };
let charts: EChartsType[] = [];
let renderGeneration = 0;

function disposeCharts(): void {
  for (const chart of charts) chart.dispose();
  charts = [];
}

function attachFilters(): void {
  const form = document.querySelector<HTMLFormElement>("#trend-filters");
  form?.addEventListener("change", (event) => {
    const changedName =
      event.target instanceof HTMLSelectElement ? event.target.name : null;
    const data = new FormData(form);
    filters = {
      os: (data.get("os") ?? "all") as DashboardFilters["os"],
      backend: (data.get("backend") ?? "all") as DashboardFilters["backend"],
      channel: (data.get("channel") ?? "all") as DashboardFilters["channel"],
      range: (data.get("range") ?? "30") as DashboardFilters["range"],
    };
    render();
    if (changedName) {
      document
        .querySelector<HTMLSelectElement>(`#trend-filters select[name="${changedName}"]`)
        ?.focus();
    }
  });
}

async function mountCharts(generation: number): Promise<void> {
  if (!index || index.runs.length === 0) return;
  const { mountHeatmap, mountTrendChart } = await import("./dashboard/charts.js");
  if (generation !== renderGeneration) return;
  const heatmap = document.querySelector<HTMLElement>("#heatmap-chart");
  if (heatmap) charts.push(mountHeatmap(heatmap, latestMatrix(index.runs[0])));
  const medianSeries = buildMedianSeries(index, filters);
  const median = document.querySelector<HTMLElement>("#median-chart");
  if (median) charts.push(mountTrendChart(median, medianSeries, "duration"));
  const deltaSeries = buildDeltaSeries(index, filters);
  const delta = document.querySelector<HTMLElement>("#delta-chart");
  if (delta) charts.push(mountTrendChart(delta, deltaSeries, "delta"));
}

function render(): void {
  if (!index) return;
  const generation = ++renderGeneration;
  disposeCharts();
  const medianSeries = buildMedianSeries(index, filters);
  const deltaSeries = buildDeltaSeries(index, filters);
  app.innerHTML = renderDashboard(
    index,
    latestRun,
    detailState,
    filters,
    medianSeries,
    deltaSeries,
  );
  attachFilters();
  requestAnimationFrame(() => {
    if (generation === renderGeneration) void mountCharts(generation);
  });
}

async function load(): Promise<void> {
  disposeCharts();
  index = null;
  latestRun = null;
  detailState = null;
  app.innerHTML = renderLoading();
  try {
    const dataRoot = `${import.meta.env.BASE_URL}data`;
    index = await loadRunIndex(window.fetch.bind(window), `${dataRoot}/index.json`);
    if (index.runs.length === 0) {
      render();
      return;
    }
    detailState = "loading";
    render();
    try {
      const runId = encodeURIComponent(index.runs[0].id);
      latestRun = await loadBenchmarkRun(
        window.fetch.bind(window),
        `${dataRoot}/runs/${runId}.json`,
      );
      detailState = null;
    } catch (error) {
      detailState = error instanceof Error ? error.message : String(error);
    }
    render();
  } catch (error) {
    app.innerHTML = renderFatalError(error instanceof Error ? error.message : String(error));
    document.querySelector<HTMLButtonElement>("#retry-load")?.addEventListener("click", () => {
      void load();
    });
  }
}

window.addEventListener("resize", () => {
  for (const chart of charts) chart.resize();
});

void load();
