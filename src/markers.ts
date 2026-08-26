/** Marker data model and undo/redo store */

export type MarkerShape = 'circle' | 'square' | 'triangle' | 'pin';

export interface MarkerAnnotation {
  id: string;
  lng: number;
  lat: number;
  shape: MarkerShape;
  color: string;
  size: number; // 0.5 – 2, multiplier on base icon size
  locked?: boolean;
}

type Action =
  | { type: 'add'; marker: MarkerAnnotation }
  | { type: 'remove'; marker: MarkerAnnotation }
  | { type: 'update'; id: string; before: Partial<MarkerAnnotation>; after: Partial<MarkerAnnotation> };

export type MarkerListener = (markers: MarkerAnnotation[]) => void;

export class MarkerStore {
  private markers: MarkerAnnotation[] = [];
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  private listeners: Set<MarkerListener> = new Set();

  subscribe(listener: MarkerListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    const snapshot = [...this.markers];
    for (const fn of this.listeners) fn(snapshot);
  }

  getAll(): MarkerAnnotation[] { return [...this.markers]; }

  add(marker: MarkerAnnotation) {
    this.markers.push(marker);
    this.undoStack.push({ type: 'add', marker });
    this.redoStack = [];
    this.notify();
  }

  remove(id: string) {
    const idx = this.markers.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const marker = this.markers[idx];
    this.markers.splice(idx, 1);
    this.undoStack.push({ type: 'remove', marker });
    this.redoStack = [];
    this.notify();
  }

  update(id: string, changes: Partial<MarkerAnnotation>) {
    const marker = this.markers.find((m) => m.id === id);
    if (!marker) return;
    const before: Partial<MarkerAnnotation> = {};
    for (const key of Object.keys(changes) as (keyof MarkerAnnotation)[]) {
      (before as any)[key] = (marker as any)[key];
      (marker as any)[key] = (changes as any)[key];
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
        this.markers.push(action.marker);
        break;
      case 'remove': {
        const idx = this.markers.findIndex((m) => m.id === action.marker.id);
        if (idx !== -1) this.markers.splice(idx, 1);
        break;
      }
      case 'update': {
        const marker = this.markers.find((m) => m.id === action.id);
        if (marker) {
          for (const key of Object.keys(action.after) as (keyof MarkerAnnotation)[]) {
            (marker as any)[key] = (action.after as any)[key];
          }
        }
        break;
      }
    }
  }

  private applyReverse(action: Action) {
    switch (action.type) {
      case 'add': {
        const idx = this.markers.findIndex((m) => m.id === action.marker.id);
        if (idx !== -1) this.markers.splice(idx, 1);
        break;
      }
      case 'remove':
        this.markers.push(action.marker);
        break;
      case 'update': {
        const marker = this.markers.find((m) => m.id === action.id);
        if (marker) {
          for (const key of Object.keys(action.before) as (keyof MarkerAnnotation)[]) {
            (marker as any)[key] = (action.before as any)[key];
          }
        }
        break;
      }
    }
  }
}

/* ---- SDF icon generation (32×32 white-on-transparent, used with icon-color) ---- */

const ICON_SIZE = 32;
const HALF = ICON_SIZE / 2;

function makeImageData(draw: (ctx: CanvasRenderingContext2D) => void): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  ctx.fillStyle = '#fff';
  draw(ctx);
  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

export function createMarkerIcons(): Record<string, { data: ImageData; sdf: boolean }> {
  return {
    'marker-circle': {
      data: makeImageData((ctx) => {
        ctx.beginPath();
        ctx.arc(HALF, HALF, HALF - 2, 0, Math.PI * 2);
        ctx.fill();
      }),
      sdf: true,
    },
    'marker-square': {
      data: makeImageData((ctx) => {
        const inset = 3;
        ctx.fillRect(inset, inset, ICON_SIZE - inset * 2, ICON_SIZE - inset * 2);
      }),
      sdf: true,
    },
    'marker-triangle': {
      data: makeImageData((ctx) => {
        ctx.beginPath();
        ctx.moveTo(HALF, 2);
        ctx.lineTo(ICON_SIZE - 2, ICON_SIZE - 2);
        ctx.lineTo(2, ICON_SIZE - 2);
        ctx.closePath();
        ctx.fill();
      }),
      sdf: true,
    },
    'marker-pin': {
      data: makeImageData((ctx) => {
        // Inverted teardrop / map pin
        const cx = HALF;
        const top = 2;
        const r = 10;
        const tipY = ICON_SIZE - 2;
        // Upper circle
        ctx.beginPath();
        ctx.arc(cx, top + r, r, Math.PI, 0);
        // Lines down to tip
        ctx.lineTo(cx, tipY);
        ctx.lineTo(cx - r, top + r);
        ctx.closePath();
        ctx.fill();
      }),
      sdf: true,
    },
  };
}
