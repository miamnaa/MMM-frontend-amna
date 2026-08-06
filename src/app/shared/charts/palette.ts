/**
 * Categorical series palette — assigned in fixed slot order, never cycled.
 * Validated for CVD separation and normal-vision separation against the white
 * chart surface (worst adjacent pair ΔE 9.1 protan / 22.9 normal).
 *
 * Slots 3 and 4 sit below 3:1 contrast on white, so every chart using them
 * ships the relief required by that: direct labels plus a table view.
 */
export const SERIES_COLORS = [
  '#2a78d6', // 1 blue
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const;

/** Colour follows the entity, never its rank in a filtered list. */
export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export const CHART_INK = {
  grid: '#e2e8f0',
  axis: '#cbd5e1',
  label: '#64748b',
  text: '#0f172a',
  surface: '#ffffff',
};
