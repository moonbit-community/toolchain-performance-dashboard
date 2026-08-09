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
  failed: "#5b3241",
  timeout: "#5f4b28",
  unavailable: "#283e42",
};

const SERIES_COLORS = [
  "#68e0cf",
  "#ffb86b",
  "#8fb8ff",
  "#ef7f93",
  "#b6e36d",
  "#d39bff",
  "#f1d36f",
  "#69c2ff",
  "#ffa8d6",
  "#9ad4a2",
  "#c7a6ff",
  "#ff8f70",
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
              borderColor: "#496166",
              borderWidth: 1,
            },
      label: {
        show: true,
        formatter: label,
        color: cell.status === "ok" ? "#071a1c" : "#f4f7f3",
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
    grid: { top: 12, right: 28, bottom: 48, left: 112 },
    tooltip: {
      trigger: "item",
      renderMode: "richText",
      borderColor: "#496166",
      backgroundColor: "#102a2d",
      textStyle: { color: "#f4f7f3" },
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
      axisLine: { lineStyle: { color: "#496166" } },
      axisTick: { show: false },
      axisLabel: { color: "#b7c7c5", interval: 0 },
    },
    yAxis: {
      type: "category",
      data: OS_IDS.map((os) => OS_LABELS[os]),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: "#b7c7c5" },
    },
    visualMap: {
      min: -extent,
      max: extent,
      show: false,
      inRange: { color: ["#59d6b1", "#d7e4d0", "#f37d78"] },
    },
    series: [
      {
        name: "Candidate delta",
        type: "heatmap",
        data,
        emphasis: {
          itemStyle: {
            borderColor: "#ffffff",
            borderWidth: 2,
            shadowBlur: 12,
            shadowColor: "rgba(0,0,0,.35)",
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
      textStyle: { color: "#b7c7c5", fontSize: 11 },
      pageTextStyle: { color: "#b7c7c5" },
      pageIconColor: "#68e0cf",
      pageIconInactiveColor: "#496166",
    },
    tooltip: {
      trigger: "axis",
      borderColor: "#496166",
      backgroundColor: "#102a2d",
      textStyle: { color: "#f4f7f3" },
      valueFormatter: (value: unknown) =>
        metric === "duration"
          ? formatDuration(typeof value === "number" ? value : Number(value))
          : formatDelta(typeof value === "number" ? value : Number(value)),
    },
    xAxis: {
      type: "time",
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#496166" } },
      axisTick: { show: false },
      axisLabel: { color: "#91a5a2", hideOverlap: true },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      name: metric === "duration" ? "Median ms" : "Delta %",
      nameTextStyle: { color: "#91a5a2" },
      axisLabel: {
        color: "#91a5a2",
        formatter: metric === "duration" ? "{value} ms" : "{value}%",
      },
      splitLine: { lineStyle: { color: "rgba(143, 174, 170, .12)" } },
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
