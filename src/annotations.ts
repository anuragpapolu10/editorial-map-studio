/** Annotation data model and undo/redo history manager */

export interface TextAnnotation {
  id: string;
  lng: number;
  lat: number;
  text: string;
  fontSize: number;
  fontFamily: 'sans' | 'serif';
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  rotation: number; // degrees, 0 = horizontal
  showBackground: boolean;
}

type Action =
  | { type: 'add'; annotation: TextAnnotation }
  | { type: 'remove'; annotation: TextAnnotation }
  | { type: 'update'; id: string; before: Partial<TextAnnotation>; after: Partial<TextAnnotation> };

export type AnnotationListener = (annotations: TextAnnotation[]) => void;

export class AnnotationStore {
  private annotations: TextAnnotation[] = [];
  private undoStack: Action[] = [];
  private redoStack: Action[] = [];
  private listeners: Set<AnnotationListener> = new Set();

  subscribe(listener: AnnotationListener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify() {
    const snapshot = [...this.annotations];
    for (const fn of this.listeners) fn(snapshot);
  }

  getAll(): TextAnnotation[] {
    return [...this.annotations];
  }

  /* ---------- mutations ---------- */

  add(annotation: TextAnnotation) {
    this.annotations.push(annotation);
    this.undoStack.push({ type: 'add', annotation });
    this.redoStack = [];
    this.notify();
  }

  remove(id: string) {
    const idx = this.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return;
    const annotation = this.annotations[idx];
    this.annotations.splice(idx, 1);
    this.undoStack.push({ type: 'remove', annotation });
    this.redoStack = [];
    this.notify();
  }

  update(id: string, changes: Partial<TextAnnotation>) {
    const ann = this.annotations.find((a) => a.id === id);
    if (!ann) return;
    const before: Partial<TextAnnotation> = {};
    for (const key of Object.keys(changes) as (keyof TextAnnotation)[]) {
      (before as any)[key] = ann[key];
      (ann as any)[key] = changes[key];
    }
    this.undoStack.push({ type: 'update', id, before, after: changes });
    this.redoStack = [];
    this.notify();
  }

  /* ---------- undo / redo ---------- */

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
        this.annotations.push(action.annotation);
        break;
      case 'remove': {
        const idx = this.annotations.findIndex((a) => a.id === action.annotation.id);
        if (idx !== -1) this.annotations.splice(idx, 1);
        break;
      }
      case 'update': {
        const ann = this.annotations.find((a) => a.id === action.id);
        if (ann) {
          for (const key of Object.keys(action.after) as (keyof TextAnnotation)[]) {
            (ann as any)[key] = action.after[key];
          }
        }
        break;
      }
    }
  }

  private applyReverse(action: Action) {
    switch (action.type) {
      case 'add': {
        const idx = this.annotations.findIndex((a) => a.id === action.annotation.id);
        if (idx !== -1) this.annotations.splice(idx, 1);
        break;
      }
      case 'remove':
        this.annotations.push(action.annotation);
        break;
      case 'update': {
        const ann = this.annotations.find((a) => a.id === action.id);
        if (ann) {
          for (const key of Object.keys(action.before) as (keyof TextAnnotation)[]) {
            (ann as any)[key] = action.before[key];
          }
        }
        break;
      }
    }
  }
}
