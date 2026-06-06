/** Arrow data model, Catmull-Rom spline math, and undo/redo store */

import type { StrokeStyle } from './shapes';

export interface ArrowAnnotation {
  id: string;
  points: [number, number][];  // [lng, lat] — first=start, last=end, middle=bend points
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
}

/* ---- Catmull-Rom spline math ---- */

/** Evaluate a Catmull-Rom segment between p1 and p2, given surrounding points p0 and p3 */
function catmullRomPoint(
  p0: [number, number], p1: [number, number],
  p2: [number, number], p3: [number, number],
  t: number,
): [number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

/** Sample the full Catmull-Rom spline through an array of points.
 *  Returns a dense polyline. For 2 points, returns a straight line. */
export function sampleSpline(
  points: [number, number][],
  segmentsPerSpan = 16,
): [number, number][] {
  if (points.length < 2) return [...points];
  if (points.length === 2) return [...points];

  const result: [number, number][] = [];
  const n = points.length;

  for (let i = 0; i < n - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, n - 1)];

    for (let j = 0; j < segmentsPerSpan; j++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, j / segmentsPerSpan));
    }
  }
  // Add the final point
  result.push(points[n - 1]);
  return result;
}

/** Find the closest point on the sampled spline to a given point.
 *  Returns { segmentIndex, t, distance } where segmentIndex is the span
 *  in the original points array between which the closest point lies. */
export function findClosestPointOnSpline(
  points: [number, number][],
  target: [number, number],
  segmentsPerSpan = 16,
): { segmentIndex: number; distance: number } {
  if (points.length < 2) return { segmentIndex: 0, distance: Infinity };

  const sampled = sampleSpline(points, segmentsPerSpan);
  let minDist = Infinity;
  let minSampleIdx = 0;

  for (let i = 0; i < sampled.length; i++) {
    const dx = sampled[i][0] - target[0];
    const dy = sampled[i][1] - target[1];
    const dist = dx * dx + dy * dy;
    if (dist < minDist) {
      minDist = dist;
      minSampleIdx = i;
    }
  }

  // Convert sample index back to segment index in original points
  const segmentIndex = Math.min(
    Math.floor(minSampleIdx / segmentsPerSpan),
    points.length - 2,
  );

  return { segmentIndex, distance: Math.sqrt(minDist) };
}

/* ---- GeoJSON generation ---- */

export function arrowToFeatures(
  arrow: ArrowAnnotation,
  selected: boolean,
): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];
  const baseProps = {
    id: arrow.id,
    stroke: arrow.stroke,
    strokeWidth: arrow.strokeWidth,
    strokeStyle: arrow.strokeStyle,
    selected,
  };

  const pts = arrow.points;
  if (pts.length < 2) return features;

  // Compute shaft coordinates and arrowhead
  let shaftCoords: [number, number][] = pts.length === 2 ? [...pts] : sampleSpline(pts);

  // Arrowhead — clamped size (proportional to arrow but with min/max),
  // shaft ends at arrowhead midpoint, direction from shaft's final segment
  const end = pts[pts.length - 1];
  const start = pts[0];
  const adx = end[0] - start[0];
  const ady = end[1] - start[1];
  const arrowLen = Math.sqrt(adx * adx + ady * ady);
  const headLen = arrowLen * 0.08;

  // Step 1: Trim shaft — remove points within half headLen of the endpoint
  const trimDist2 = (headLen * 0.5) * (headLen * 0.5);
  while (shaftCoords.length > 1) {
    const pt = shaftCoords[shaftCoords.length - 1];
    const dx = pt[0] - end[0];
    const dy = pt[1] - end[1];
    if (dx * dx + dy * dy < trimDist2) {
      shaftCoords.pop();
    } else {
      break;
    }
  }

  // Step 2: Compute arrowhead direction from the shaft's last point toward the endpoint
  // This guarantees the arrowhead is perfectly centered on the shaft
  const lastShaftPt = shaftCoords[shaftCoords.length - 1];
  const tdx = end[0] - lastShaftPt[0];
  const tdy = end[1] - lastShaftPt[1];
  const mag = Math.sqrt(tdx * tdx + tdy * tdy);

  if (mag > 0 && headLen > 0) {
    const nx = tdx / mag;
    const ny = tdy / mag;

    // Midpoint of arrowhead: half headLen back from tip
    const midCenter: [number, number] = [
      end[0] - headLen * 0.5 * nx,
      end[1] - headLen * 0.5 * ny,
    ];
    shaftCoords.push(midCenter);

    const halfAngle = Math.PI / 7; // ~25.7 degrees
    const cosA = Math.cos(Math.PI - halfAngle);
    const sinA = Math.sin(Math.PI - halfAngle);
    const cosB = Math.cos(Math.PI + halfAngle);
    const sinB = Math.sin(Math.PI + halfAngle);

    const wing1: [number, number] = [
      end[0] + headLen * (nx * cosA - ny * sinA),
      end[1] + headLen * (nx * sinA + ny * cosA),
    ];
    const wing2: [number, number] = [
      end[0] + headLen * (nx * cosB - ny * sinB),
      end[1] + headLen * (nx * sinB + ny * cosB),
    ];

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[wing1, [...end] as [number, number], wing2, wing1]],
      },
      properties: { ...baseProps, featureType: 'head' },
    });
  }

  // Shaft LineString (after arrowhead trimming so shaft ends at arrowhead base)
  features.push({
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: shaftCoords },
    properties: { ...baseProps, featureType: 'shaft' },
  });

  // Control point handles (when selected and has 3+ points, show all points)
  if (selected) {
    // Guide lines connecting consecutive points
    for (let i = 0; i < pts.length - 1; i++) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [pts[i], pts[i + 1]] },
        properties: { id: arrow.id, featureType: 'cp-line' },
      });
    }
    // Handle circles for ALL points (start, intermediates, end)
    for (let i = 0; i < pts.length; i++) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: pts[i] },
        properties: {
          id: arrow.id,
          featureType: 'cp',
          cpIndex: i,
          isEndpoint: i === 0 || i === pts.length - 1 ? 1 : 0,
        },
      });
    }
  }

  return features;
}

/* ---- Store (same command-pattern as ShapeStore / MarkerStore) ---- */

type Action =
  | { type: 'add'; arrow: ArrowAnnotation }
  | { type: 'remove'; arrow: ArrowAnnotation }
  | { type: 'update'; id: string; before: Partial<ArrowAnnotation>; after: Partial<ArrowAnnotation> };

export type ArrowListener = (arrows: ArrowAnnotation[]) => void;

export class ArrowStore {
  private arrows: ArrowAnnotation[] = [];
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  private listeners: Set<ArrowListener> = new Set();

  subscribe(listener: ArrowListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    const snapshot = [...this.arrows];
    for (const fn of this.listeners) fn(snapshot);
  }

  getAll(): ArrowAnnotation[] { return [...this.arrows]; }

  add(arrow: ArrowAnnotation) {
    this.arrows.push(arrow);
    this.undoStack.push({ type: 'add', arrow });
    this.redoStack = [];
    this.notify();
  }

  remove(id: string) {
    const idx = this.arrows.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const arrow = this.arrows[idx];
    this.arrows.splice(idx, 1);
    this.undoStack.push({ type: 'remove', arrow });
    this.redoStack = [];
    this.notify();
  }

  update(id: string, changes: Partial<ArrowAnnotation>) {
    const arrow = this.arrows.find((a) => a.id === id);
    if (!arrow) return;
    const before: Partial<ArrowAnnotation> = {};
    for (const key of Object.keys(changes) as (keyof ArrowAnnotation)[]) {
      (before as any)[key] = (arrow as any)[key];
      (arrow as any)[key] = (changes as any)[key];
    }
    this.undoStack.push({ type: 'update', id, before, after: changes });
    this.redoStack = [];
    this.notify();
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return;
    this.applyReverse(action);
    this.redoStack.push(action);
    this.notify();
  }

  redo() {
    const action = this.redoStack.pop();
    if (!action) return;
    this.applyForward(action);
    this.undoStack.push(action);
    this.notify();
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  private applyForward(action: Action) {
    switch (action.type) {
      case 'add':
        this.arrows.push(action.arrow);
        break;
      case 'remove': {
        const idx = this.arrows.findIndex((a) => a.id === action.arrow.id);
        if (idx !== -1) this.arrows.splice(idx, 1);
        break;
      }
      case 'update': {
        const arrow = this.arrows.find((a) => a.id === action.id);
        if (arrow) {
          for (const key of Object.keys(action.after) as (keyof ArrowAnnotation)[]) {
            (arrow as any)[key] = (action.after as any)[key];
          }
        }
        break;
      }
    }
  }

  private applyReverse(action: Action) {
    switch (action.type) {
      case 'add': {
        const idx = this.arrows.findIndex((a) => a.id === action.arrow.id);
        if (idx !== -1) this.arrows.splice(idx, 1);
        break;
      }
      case 'remove':
        this.arrows.push(action.arrow);
        break;
      case 'update': {
        const arrow = this.arrows.find((a) => a.id === action.id);
        if (arrow) {
          for (const key of Object.keys(action.before) as (keyof ArrowAnnotation)[]) {
            (arrow as any)[key] = (action.before as any)[key];
          }
        }
        break;
      }
    }
  }
}
