export interface ReaderPreferences {
  automaticContinuation: boolean;
  zoom: number;
  spacing: "none" | "small" | "medium" | "large";
  background: "black" | "oled" | "dark" | "light";
}
export const defaults: ReaderPreferences = { automaticContinuation: true, zoom: 100, spacing: "none", background: "black" };
export function validatePreferences(value: unknown): ReaderPreferences {
  const result = { ...defaults };
  if (!value || typeof value !== "object") return result;
  const data = value as Record<string, unknown>;
  if (typeof data.automaticContinuation === "boolean") result.automaticContinuation = data.automaticContinuation;
  if (typeof data.zoom === "number" && Number.isInteger(data.zoom) && data.zoom >= 60 && data.zoom <= 140) result.zoom = data.zoom;
  if (typeof data.spacing === "string" && ["none", "small", "medium", "large"].includes(data.spacing)) result.spacing = data.spacing as ReaderPreferences["spacing"];
  if (typeof data.background === "string" && ["black", "oled", "dark", "light"].includes(data.background)) result.background = data.background as ReaderPreferences["background"];
  return result;
}
