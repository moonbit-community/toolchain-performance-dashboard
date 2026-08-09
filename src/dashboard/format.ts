import type { ToolchainVersionV1, UnitStatus } from "../data/types.js";

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDuration(milliseconds: number | null, digits = 1): string {
  if (milliseconds === null || !Number.isFinite(milliseconds)) return "—";
  if (milliseconds >= 1_000) return `${(milliseconds / 1_000).toFixed(2)} s`;
  return `${milliseconds.toFixed(digits)} ms`;
}

export function formatDelta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const rounded = value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded}%`;
}

export function deltaMeaning(value: number | null): string {
  if (value === null) return "No comparison";
  if (Math.abs(value) < 0.05) return "Effectively even";
  return value < 0 ? "Candidate faster" : "Candidate slower";
}

export function formatUtc(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
    hour12: false,
  }).format(date) + " UTC";
}

export function formatLocal(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

export function shortSha(value: string): string {
  return value.slice(0, 8);
}

export function toolchainLabel(toolchain: ToolchainVersionV1): string {
  if (toolchain.installationStatus !== "ok") return "Unavailable";
  return toolchain.version ?? "Version parse failed";
}

export function statusIcon(status: UnitStatus | "healthy" | "partial" | "failed"): string {
  switch (status) {
    case "ok":
    case "healthy":
      return "✓";
    case "partial":
      return "!";
    case "timeout":
      return "◷";
    case "unavailable":
      return "—";
    case "failed":
      return "×";
  }
}

export function statusBadge(status: UnitStatus | "healthy" | "partial" | "failed"): string {
  return `<span class="status status--${escapeHtml(status)}"><span aria-hidden="true">${statusIcon(status)}</span>${escapeHtml(status)}</span>`;
}
