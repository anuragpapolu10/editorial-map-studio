/** Shift-key constraint helpers for drawing tools.
 *  All functions correct for lat/lng distortion using cos(latitude). */

/** Longitude scale factor at a given latitude */
function lngScale(lat: number): number {
  return Math.cos((lat * Math.PI) / 180);
}

/** Snap an endpoint to the nearest 45° angle from start (8 directions).
 *  Works in projected (visual) space to get correct screen angles. */
export function snapTo45(
  start: [number, number],
  end: [number, number],
): [number, number] {
  const scale = lngScale((start[1] + end[1]) / 2);
  // Convert to visual space (scale lng by cos(lat))
  const vdx = (end[0] - start[0]) * scale;
  const vdy = end[1] - start[1];
  const angle = Math.atan2(vdy, vdx);
  const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  const dist = Math.sqrt(vdx * vdx + vdy * vdy);
  // Convert back to lng/lat
  return [
    start[0] + (dist * Math.cos(snapped)) / scale,
    start[1] + dist * Math.sin(snapped),
  ];
}

/** Constrain a drag endpoint to produce a visual square (equal screen width/height) */
export function snapSquare(
  corner1: [number, number],
  corner2: [number, number],
): [number, number] {
  const scale = lngScale((corner1[1] + corner2[1]) / 2);
  const vdx = (corner2[0] - corner1[0]) * scale; // visual width
  const dy = corner2[1] - corner1[1];             // visual height = dy
  const size = Math.max(Math.abs(vdx), Math.abs(dy));
  return [
    corner1[0] + (size * Math.sign(vdx || 1)) / scale,
    corner1[1] + size * Math.sign(dy || 1),
  ];
}

/** Constrain rx/ry to produce a visual circle (equal screen radii).
 *  Takes the latitude for projection correction. */
export function snapCircle(
  rx: number, ry: number, lat: number,
): { rx: number; ry: number } {
  const scale = lngScale(lat);
  const vrx = rx * scale; // visual radius x
  const vr = Math.max(vrx, ry); // pick the larger visual radius
  return { rx: vr / scale, ry: vr };
}
