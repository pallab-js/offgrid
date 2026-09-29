/** Pick ink or inverse-ink for a given pastel/solid background. */
export function onColor(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#000000";
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return luminance > 0.45 ? "#000000" : "#ffffff";
}

/** Peer identity colors — the documented block palette (DESIGN.md). */
export const IDENTITY_COLORS = [
  "#dceeb1", // lime
  "#c5b0f4", // lilac
  "#f4ecd6", // cream
  "#efd4d4", // pink
  "#c8e6cd", // mint
  "#f3c9b6", // coral
  "#1f1d3d", // navy
] as const;
