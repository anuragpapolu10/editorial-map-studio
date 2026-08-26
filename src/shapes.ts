/** Shape data model and undo/redo store */

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';
export type FillPattern = 'solid' | 'hatch' | 'crosshatch';

export interface ShapeAnnotation {
  id: string;
  type: 'rectangle' | 'ellipse' | 'line' | 'polygon' | 'pen' | 'brush';
  vertices: [number, number][]; // [lng, lat] pairs — already includes rotation
  rotation: number; // degrees, tracked for UI; vertices are the rotated coords
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  fill: string;
  fillOpacity: number;
  fillPattern?: FillPattern;
  hatchScale?: number;
  showDirectionArrows?: boolean;
  reverseDirection?: boolean;
  locked?: boolean;
}

type Action =
  | { type: 'add'; shape: ShapeAnnotation }
  | { type: 'remove'; shape: ShapeAnnotation }
  | { type: 'update'; id: string; before: Partial<ShapeAnnotation>; after: Partial<ShapeAnnotation> };

export type ShapeListener = (shapes: ShapeAnnotation[]) => void;

export class ShapeStore {
  private shapes: ShapeAnnotation[] = [];
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  private listeners: Set<ShapeListener> = new Set();

  subscribe(listener: ShapeListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    const snapshot = [...this.shapes];
    for (const fn of this.listeners) fn(snapshot);
  }

  getAll(): ShapeAnnotation[] { return [...this.shapes]; }

  add(shape: ShapeAnnotation) {
    this.shapes.push(shape);
    this.undoStack.push({ type: 'add', shape });
    this.redoStack = [];
    this.notify();
  }

  remove(id: string) {
    const idx = this.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const shape = this.shapes[idx];
    this.shapes.splice(idx, 1);
    this.undoStack.push({ type: 'remove', shape });
    this.redoStack = [];
    this.notify();
  }

  update(id: string, changes: Partial<ShapeAnnotation>) {
    const shape = this.shapes.find((s) => s.id === id);
    if (!shape) return;
    const before: Partial<ShapeAnnotation> = {};
    for (const key of Object.keys(changes) as (keyof ShapeAnnotation)[]) {
      (before as any)[key] = (shape as any)[key];
      (shape as any)[key] = (changes as any)[key];
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
        this.shapes.push(action.shape);
        break;
      case 'remove': {
        const idx = this.shapes.findIndex((s) => s.id === action.shape.id);
        if (idx !== -1) this.shapes.splice(idx, 1);
        break;
      }
      case 'update': {
        const shape = this.shapes.find((s) => s.id === action.id);
        if (shape) {
          for (const key of Object.keys(action.after) as (keyof ShapeAnnotation)[]) {
            (shape as any)[key] = (action.after as any)[key];
          }
        }
        break;
      }
    }
  }

  private applyReverse(action: Action) {
    switch (action.type) {
      case 'add': {
        const idx = this.shapes.findIndex((s) => s.id === action.shape.id);
        if (idx !== -1) this.shapes.splice(idx, 1);
        break;
      }
      case 'remove':
        this.shapes.push(action.shape);
        break;
      case 'update': {
        const shape = this.shapes.find((s) => s.id === action.id);
        if (shape) {
          for (const key of Object.keys(action.before) as (keyof ShapeAnnotation)[]) {
            (shape as any)[key] = (action.before as any)[key];
          }
        }
        break;
      }
    }
  }
}

/* ---- Geometry helpers ---- */

export function getCentroid(vertices: [number, number][]): [number, number] {
  // For closed shapes, skip the closing vertex (same as first)
  const pts = vertices.length > 2 &&
    vertices[0][0] === vertices[vertices.length - 1][0] &&
    vertices[0][1] === vertices[vertices.length - 1][1]
    ? vertices.slice(0, -1)
    : vertices;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  return [sx / pts.length, sy / pts.length];
}

export function rotateVertices(
  vertices: [number, number][],
  centroid: [number, number],
  angleDeg: number,
): [number, number][] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return vertices.map(([x, y]) => {
    const dx = x - centroid[0];
    const dy = y - centroid[1];
    return [centroid[0] + dx * cos - dy * sin, centroid[1] + dx * sin + dy * cos];
  });
}

export function translateVertices(
  vertices: [number, number][],
  dlng: number,
  dlat: number,
): [number, number][] {
  return vertices.map(([x, y]) => [x + dlng, y + dlat]);
}

export function makeRectVertices(
  corner1: [number, number],
  corner2: [number, number],
): [number, number][] {
  return [
    [corner1[0], corner1[1]],
    [corner2[0], corner1[1]],
    [corner2[0], corner2[1]],
    [corner1[0], corner2[1]],
    [corner1[0], corner1[1]], // close
  ];
}

export function makeEllipseVertices(
  center: [number, number],
  rx: number,
  ry: number,
  segments = 64,
): [number, number][] {
  const verts: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * 2 * Math.PI;
    verts.push([center[0] + rx * Math.cos(a), center[1] + ry * Math.sin(a)]);
  }
  return verts;
}

export function resizeRectCorner(
  vertices: [number, number][],
  rotation: number,
  cornerIndex: number,
  newPos: [number, number],
): [number, number][] {
  const corners = vertices.slice(0, 4);
  const center = getCentroid(corners);
  const rot = rotation || 0;

  const unrotated = rot !== 0 ? rotateVertices(corners, center, -rot) : corners.map(c => [...c] as [number, number]);
  const newPosUnrot = rot !== 0 ? rotateVertices([newPos], center, -rot)[0] : newPos;

  const sameX = (a: number, b: number) => [0, 3].includes(a) === [0, 3].includes(b);
  const sameY = (a: number, b: number) => (a <= 1) === (b <= 1);

  const newCorners: [number, number][] = unrotated.map((c, j) => {
    if (j === cornerIndex) return [...newPosUnrot] as [number, number];
    return [
      sameX(cornerIndex, j) ? newPosUnrot[0] : c[0],
      sameY(cornerIndex, j) ? newPosUnrot[1] : c[1],
    ];
  });

  const newVerts: [number, number][] = [...newCorners, [...newCorners[0]] as [number, number]];
  if (rot !== 0) {
    const newCenter = getCentroid(newCorners);
    return rotateVertices(newVerts, newCenter, rot);
  }
  return newVerts;
}

export function resizeEllipseCardinal(
  vertices: [number, number][],
  rotation: number,
  handleIndex: number,
  newPos: [number, number],
): [number, number][] {
  const center = getCentroid(vertices);
  const rot = rotation || 0;

  const unrotated = rot !== 0 ? rotateVertices(vertices, center, -rot) : vertices;
  const newPosUnrot = rot !== 0 ? rotateVertices([newPos], center, -rot)[0] : newPos;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of unrotated) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let rx = (maxX - minX) / 2;
  let ry = (maxY - minY) / 2;

  if (handleIndex === 0 || handleIndex === 32) {
    rx = Math.max(Math.abs(newPosUnrot[0] - cx), 0.0001);
  } else {
    ry = Math.max(Math.abs(newPosUnrot[1] - cy), 0.0001);
  }

  const newVerts = makeEllipseVertices([cx, cy], rx, ry);
  if (rot !== 0) {
    return rotateVertices(newVerts, [cx, cy], rot);
  }
  return newVerts;
}

/* ---- Douglas-Peucker path simplification ---- */

function perpendicularDist(
  pt: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number],
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((pt[0] - lineStart[0]) ** 2 + (pt[1] - lineStart[1]) ** 2);
  const t = Math.max(0, Math.min(1, ((pt[0] - lineStart[0]) * dx + (pt[1] - lineStart[1]) * dy) / lenSq));
  const projX = lineStart[0] + t * dx;
  const projY = lineStart[1] + t * dy;
  return Math.sqrt((pt[0] - projX) ** 2 + (pt[1] - projY) ** 2);
}

export function simplifyPath(
  points: [number, number][],
  epsilon: number,
): [number, number][] {
  if (points.length <= 2) return [...points];
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], points[0], points[points.length - 1]);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
    const right = simplifyPath(points.slice(maxIdx), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[points.length - 1]];
}

/* ---- Path buffering (creates a polygon from a polyline + radius) ---- */

export function bufferPath(
  points: [number, number][],
  radius: number,
): [number, number][] {
  if (points.length < 2) return [];
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < points.length; i++) {
    let nx: number, ny: number;
    if (i === 0) {
      const dx = points[1][0] - points[0][0];
      const dy = points[1][1] - points[0][1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / len; ny = dx / len;
    } else if (i === points.length - 1) {
      const dx = points[i][0] - points[i - 1][0];
      const dy = points[i][1] - points[i - 1][1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      nx = -dy / len; ny = dx / len;
    } else {
      const dx1 = points[i][0] - points[i - 1][0];
      const dy1 = points[i][1] - points[i - 1][1];
      const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
      const dx2 = points[i + 1][0] - points[i][0];
      const dy2 = points[i + 1][1] - points[i][1];
      const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
      nx = -(dy1 / len1 + dy2 / len2) / 2;
      ny = (dx1 / len1 + dx2 / len2) / 2;
      const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
      nx /= nlen; ny /= nlen;
    }
    left.push([points[i][0] + nx * radius, points[i][1] + ny * radius]);
    right.push([points[i][0] - nx * radius, points[i][1] - ny * radius]);
  }

  const polygon = [...left, ...right.reverse(), left[0]];
  return polygon;
}
