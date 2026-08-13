import { HeatmapChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { BACKENDS, OS_IDS, type UnitStatus } from "../data/types.js";
import {
  BACKEND_LABELS,
  OS_LABELS,
  type MatrixCell,
  type TrendSeries,
} from "./model.js";
import { deltaMeaning, formatDelta, formatDuration } from "./format.js";

echarts.use([
  HeatmapChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);

const STATUS_COLORS: Record<Exclude<UnitStatus, "ok">, string> = {
  failed: "#fef2f2",
  timeout: "#fffbeb",
  unavailable: "#f3f4f6",
};

const STATUS_TEXT_COLORS: Record<Exclude<UnitStatus, "ok">, string> = {
  failed: "#a12f2a",
  timeout: "#92400e",
  unavailable: "#4b5563",
};

const SERIES_COLORS = [
  "#007065",
  "#d97706",
  "#2563eb",
  "#be185d",
  "#65a30d",
  "#7c3aed",
  "#b45309",
  "#0284c7",
  "#db2777",
  "#15803d",
  "#9333ea",
  "#dc2626",
];

export function mountHeatmap(element: HTMLElement, cells: readonly MatrixCell[]): EChartsType {
  const chart = echarts.init(element, undefined, { renderer: "canvas" });
  const healthyDeltas = cells
    .map((cell) => cell.deltaPercent)
    .filter((value): value is number => value !== null);
  const extent = Math.max(5, ...healthyDeltas.map((value) => Math.abs(value)));
  const data = cells.map((cell) => {
    const x = BACKENDS.indexOf(cell.backend);
    const y = OS_IDS.indexOf(cell.os);
    const label = cell.status === "ok" ? formatDelta(cell.deltaPercent) : cell.status;
    return {
      value: [x, y, cell.deltaPercent ?? 0],
      cell,
      itemStyle:
        cell.status === "ok"
          ? undefined
          : {
              color: STATUS_COLORS[cell.status],
              borderColor: "#ffffff",
              borderWidth: 4,
            },
      label: {
        show: true,
        formatter: label,
        color: cell.status === "ok" ? "#111827" : STATUS_TEXT_COLORS[cell.status],
        fontWeight: 700,
      },
    };
  });
  const textualSummary = cells
    .map(
      (cell) =>
        `${OS_LABELS[cell.os]} ${BACKEND_LABELS[cell.backend]}: ${
          cell.status === "ok"
            ? `${formatDelta(cell.deltaPercent)}, ${deltaMeaning(cell.deltaPercent)}`
            : cell.status
        }`,
    )
    .join(". ");

  chart.setOption({
    animationDuration: 450,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      description: `Latest candidate versus stable performance matrix. ${textualSummary}`,
      decal: { show: true },
    },
    grid: { top: 10, right: 18, bottom: 44, left: element.clientWidth < 560 ? 92 : 106 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      borderColor: "#d1d5db",
      backgroundColor: "#ffffff",
      textStyle: { color: "#111827" },
      extraCssText: "box-shadow: 0 8px 24px rgba(17,24,39,.1); border-radius: 8px;",
      formatter: (parameter: unknown) => {
        const item = parameter as { data?: { cell?: MatrixCell } };
        const cell = item.data?.cell;
        if (!cell) return "No benchmark data";
        if (cell.status !== "ok") {
          return `${OS_LABELS[cell.os]} · ${BACKEND_LABELS[cell.backend]}\n${cell.status}${
            cell.errorSummary ? `\n${cell.errorSummary.slice(0, 160)}` : ""
          }`;
        }
        return [
          `${OS_LABELS[cell.os]} · ${BACKEND_LABELS[cell.backend]}`,
          `${formatDelta(cell.deltaPercent)} · ${deltaMeaning(cell.deltaPercent)}`,
          `Stable ${formatDuration(cell.stableMedianMs)}`,
          `${cell.candidateChannel} ${formatDuration(cell.candidateMedianMs)}`,
        ].join("\n");
      },
    },
    xAxis: {
      type: "category",
      data: BACKENDS.map((backend) => BACKEND_LABELS[backend]),
      axisLine: { lineStyle: { color: "#d1d5db" } },
      axisTick: { show: false },
      axisLabel: { color: "#4b5563", fontSize: 11, interval: 0 },
    },
    yAxis: {
      type: "category",
      data: OS_IDS.map((os) => OS_LABELS[os]),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#4b5563", fontSize: 11 },
    },
    visualMap: {
      min: -extent,
      max: extent,
      show: false,
      inRange: { color: ["#66cbb7", "#e9efed", "#ee9b96"] },
    },
    series: [
      {
        name: "Candidate delta",
        type: "heatmap",
        data,
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 4,
          borderRadius: 6,
        },
        emphasis: {
          itemStyle: {
            borderColor: "#007065",
            borderWidth: 2,
            shadowBlur: 8,
            shadowColor: "rgba(17,24,39,.16)",
          },
        },
      },
    ],
  });
  return chart;
}

export function mountTrendChart(
  element: HTMLElement,
  series: readonly TrendSeries[],
  metric: "duration" | "delta",
): EChartsType {
  const chart = echarts.init(element, undefined, { renderer: "canvas" });
  const summary = series
    .map((item) => {
      const latest = item.points[item.points.length - 1];
      return latest
        ? `${item.name}: ${metric === "duration" ? formatDuration(latest.value) : formatDelta(latest.value)}`
        : null;
    })
    .filter(Boolean)
    .join(". ");

  chart.setOption({
    animationDuration: 350,
    backgroundColor: "transparent",
    color: SERIES_COLORS,
    aria: {
      enabled: true,
      description: `${metric === "duration" ? "Median duration" : "Candidate delta"} trend. ${summary}`,
      decal: { show: true },
    },
    grid: { top: 42, right: 22, bottom: 52, left: 64 },
    legend: {
      type: "scroll",
      top: 0,
      textStyle: { color: "#4b5563", fontSize: 11 },
      pageTextStyle: { color: "#6b7280" },
      pageIconColor: "#007065",
      pageIconInactiveColor: "#d1d5db",
    },
    tooltip: {
      trigger: "axis",
      borderColor: "#d1d5db",
      backgroundColor: "#ffffff",
      textStyle: { color: "#111827" },
      extraCssText: "box-shadow: 0 8px 24px rgba(17,24,39,.1); border-radius: 8px;",
      valueFormatter: (value: unknown) =>
        metric === "duration"
          ? formatDuration(typeof value === "number" ? value : Number(value))
          : formatDelta(typeof value === "number" ? value : Number(value)),
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#d1d5db" } },
      axisTick: { show: false },
      axisLabel: { color: "#6b7280", hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: metric === "duration" ? "Median ms" : "Delta %",
      nameTextStyle: { color: "#6b7280" },
      axisLabel: {
        color: "#6b7280",
        formatter: metric === "duration" ? "{value} ms" : "{value}%",
      },
      splitLine: { lineStyle: { color: "#eef0f2" } },
    },
    series: series.map((item) => ({
      id: item.id,
      name: item.name,
      type: "line",
      showSymbol: item.points.length < 20,
      symbol: item.channel === "nightly" ? "diamond" : item.role === "stable" ? "circle" : "triangle",
      symbolSize: 7,
      connectNulls: false,
      smooth: 0.12,
      lineStyle: {
        type: item.role === "stable" ? "solid" : item.channel === "nightly" ? "dashed" : "dotted",
        width: item.role === "delta" ? 2.5 : 2,
      },
      data: item.points.map((point) => [point.timestamp, point.value]),
    })),
  });
  return chart;
}
