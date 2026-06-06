/**
 * Scale bar computation for map exports and live preview.
 *
 * Given a map's zoom level and center latitude, computes a human-friendly
 * scale bar with a round-number distance and corresponding pixel width.
 */

export type ScaleUnit = 'metric' | 'imperial' | 'nautical';

/** Nice round distances to snap to (in base unit for each system) */
const METRIC_STOPS_M = [
  1, 2, 5, 10, 20, 50, 100, 200, 500,
  1_000, 2_000, 5_000, 10_000, 20_000, 50_000,
  100_000, 200_000, 500_000, 1_000_000, 2_000_000,
];

/** Imperial stops in feet */
const IMPERIAL_STOPS_FT = [
  5, 10, 20, 50, 100, 200, 500, 1_000, 2_000,
  // Switch to miles (5280 ft = 1 mi)
  5_280,           // 1 mi
  5_280 * 2,       // 2 mi
  5_280 * 5,       // 5 mi
  5_280 * 10,      // 10 mi
  5_280 * 20,      // 20 mi
  5_280 * 50,      // 50 mi
  5_280 * 100,     // 100 mi
  5_280 * 200,     // 200 mi
  5_280 * 500,     // 500 mi
  5_280 * 1_000,   // 1000 mi
];

/** Nautical stops in meters (1 nmi = 1852 m) */
const NAUTICAL_STOPS_M = [
  1852 * 0.1,   // 0.1 nmi
  1852 * 0.2,
  1852 * 0.5,
  1852,         // 1 nmi
  1852 * 2,
  1852 * 5,
  1852 * 10,
  1852 * 20,
  1852 * 50,
  1852 * 100,
  1852 * 200,
  1852 * 500,
  1852 * 1_000,
];

const FEET_PER_METER = 3.28084;
const NMI_M = 1852;

export interface ScaleBarInfo {
  /** Pixel width of the bar */
  widthPx: number;
  /** Human-readable label, e.g. "500 m" or "20 km" */
  label: string;
}

/**
 * Compute scale bar dimensions.
 * @param zoom      Current map zoom level
 * @param lat       Center latitude in degrees
 * @param unit      Unit system
 * @param maxBarPx  Maximum desired bar width in CSS pixels (default 150)
 */
export function computeScaleBar(
  zoom: number,
  lat: number,
  unit: ScaleUnit = 'metric',
  maxBarPx = 150,
): ScaleBarInfo {
  const metersPerPx = 156543.03392 * Math.cos((lat * Math.PI) / 180) / Math.pow(2, zoom);

  if (unit === 'imperial') {
    const feetPerPx = metersPerPx * FEET_PER_METER;
    const maxFeet = feetPerPx * maxBarPx;

    let bestStop = IMPERIAL_STOPS_FT[0];
    for (const stop of IMPERIAL_STOPS_FT) {
      if (stop <= maxFeet) bestStop = stop;
      else break;
    }

    const widthPx = bestStop / feetPerPx;
    const label = bestStop >= 5280
      ? `${Math.round(bestStop / 5280)} mi`
      : `${bestStop} ft`;

    return { widthPx, label };
  }

  if (unit === 'nautical') {
    const maxMeters = metersPerPx * maxBarPx;

    let bestStop = NAUTICAL_STOPS_M[0];
    for (const stop of NAUTICAL_STOPS_M) {
      if (stop <= maxMeters) bestStop = stop;
      else break;
    }

    const widthPx = bestStop / metersPerPx;
    const nmi = bestStop / NMI_M;
    const label = nmi < 1
      ? `${+nmi.toFixed(1)} nmi`
      : `${Math.round(nmi)} nmi`;

    return { widthPx, label };
  }

  // Metric (default)
  const maxMeters = metersPerPx * maxBarPx;

  let bestStop = METRIC_STOPS_M[0];
  for (const stop of METRIC_STOPS_M) {
    if (stop <= maxMeters) bestStop = stop;
    else break;
  }

  const widthPx = bestStop / metersPerPx;
  const label = bestStop >= 1000
    ? `${bestStop / 1000} km`
    : `${bestStop} m`;

  return { widthPx, label };
}
