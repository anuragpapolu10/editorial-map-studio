import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { ShapeStore } from '../shapes';
import type { ShapeAnnotation, StrokeStyle, FillPattern } from '../shapes';
import {
  getCentroid, rotateVertices, translateVertices,
  makeRectVertices, makeEllipseVertices,
  resizeRectCorner, resizeEllipseCardinal,
  simplifyPath,
} from '../shapes';
import { sampleSpline } from '../arrows';
import { SHAPE_LAYER_IDS, SHAPE_HANDLE_LAYER_ID } from './MapView';
import type { ActiveTool } from './Sidebar';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import { hitTestAllTools, setPending, consumePending, getCrossCursor } from '../crossSelect';
import { NumericInput } from './NumericInput';
import { snapTo45, snapSquare, snapCircle } from '../snap';
import { ColorPickerPopover } from './ColorPickerPopover';

interface ShapeToolsProps {
  map: maplibregl.Map | null;
  store: ShapeStore;
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
}

const SHAPE_TOOLS: { id: ActiveTool; label: string; icon: string }[] = [
  {
    id: 'rectangle',
    label: 'Rectangle',
    icon: '<rect x="3" y="5" width="14" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    id: 'ellipse',
    label: 'Ellipse',
    icon: '<ellipse cx="10" cy="10" rx="7" ry="5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  },
  {
    id: 'line',
    label: 'Line / Polygon',
    icon: '<polyline points="3,15 8,5 14,12 17,4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  {
    id: 'pen',
    label: 'Curves',
    icon: '<path d="M4,16 Q7,4 10,10 Q13,16 17,5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  },
  {
    id: 'brush',
    label: 'Free Hand',
    icon: '<path d="M5,15 C6,10 8,8 10,6 L12,4 L14,6 C12,8 10,10 9,15 Z" fill="currentColor" opacity="0.4" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>',
  },
];

const COLORS = [
  { value: '#1a1a1a', label: 'Black' },
  { value: '#8c8c8c', label: 'Grey' },
  { value: '#ffffff', label: 'White' },
  { value: '#c0392b', label: 'Red' },
  { value: '#3a9a6b', label: 'Green' },
  { value: '#3b7dd8', label: 'Blue' },
];

let idCounter = 0;
let pasteCounter = 0;
function nextId() { return `shp_${++idCounter}_${Date.now()}`; }

const TOOLTIP_MESSAGES: Record<string, string> = {
  rectangle: 'Click and drag to draw a rectangle · Shift for square',
  ellipse: 'Click and drag to draw an ellipse · Shift for circle',
  line: 'Click to place points · Shift to snap 45° · Right-click to finish · Click first point to close',
  'line-drawing': 'Click to add points · Shift to snap 45° · Delete to undo last point · Right-click to finish',
  pen: 'Click to place points · Double-click or right-click to finish · Path will be smoothed',
  'pen-drawing': 'Click to add points · Double-click or right-click to finish · Delete to undo last point',
  brush: 'Click and drag to paint · Release to finish',
  selected: 'Drag to move · Drag handles to resize · Click Done to deselect · Alt+drag to duplicate · Ctrl+C / Ctrl+V to copy/paste · Delete to remove',
};

function ensurePatternImages(map: maplibregl.Map, shapes: ShapeAnnotation[]) {
  const dpr = window.devicePixelRatio || 1;

  for (const s of shapes) {
    if (!s.fillPattern || s.fillPattern === 'solid') continue;
    const scale = s.hatchScale ?? 1;
    const key = `${s.fillPattern}-${s.fill}-${scale.toFixed(1)}`;
    if (map.hasImage(key)) continue;
    const IMG_SIZE = Math.max(4, Math.round(10 * scale * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = IMG_SIZE;
    canvas.height = IMG_SIZE;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, IMG_SIZE, IMG_SIZE);
    ctx.strokeStyle = s.fill;
    ctx.lineWidth = 1;
    ctx.lineCap = 'square';
    ctx.beginPath();
    ctx.moveTo(-1, IMG_SIZE + 1); ctx.lineTo(IMG_SIZE + 1, -1);
    ctx.moveTo(-1 - IMG_SIZE, IMG_SIZE + 1); ctx.lineTo(IMG_SIZE + 1 - IMG_SIZE, -1);
    ctx.moveTo(-1 + IMG_SIZE, IMG_SIZE + 1); ctx.lineTo(IMG_SIZE + 1 + IMG_SIZE, -1);
    ctx.stroke();
    if (s.fillPattern === 'crosshatch') {
      ctx.beginPath();
      ctx.moveTo(-1, -1); ctx.lineTo(IMG_SIZE + 1, IMG_SIZE + 1);
      ctx.moveTo(-1 + IMG_SIZE, -1); ctx.lineTo(IMG_SIZE + 1 + IMG_SIZE, IMG_SIZE + 1);
      ctx.moveTo(-1 - IMG_SIZE, -1); ctx.lineTo(IMG_SIZE + 1 - IMG_SIZE, IMG_SIZE + 1);
      ctx.stroke();
    }
    map.addImage(key, ctx.getImageData(0, 0, IMG_SIZE, IMG_SIZE), { pixelRatio: dpr });
  }
}

function isClosedShape(s: ShapeAnnotation): boolean {
  if (s.type === 'line') return false;
  if (s.type === 'pen' || s.type === 'brush') {
    const v = s.vertices;
    return v.length > 2 && v[0][0] === v[v.length - 1][0] && v[0][1] === v[v.length - 1][1];
  }
  return true;
}

function generateHandleFeatures(shape: ShapeAnnotation, vertices?: [number, number][]): GeoJSON.Feature[] {
  const verts = vertices || shape.vertices;
  const features: GeoJSON.Feature[] = [];

  if (shape.type === 'rectangle') {
    for (let i = 0; i < 4; i++) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: verts[i] },
        properties: { shapeId: shape.id, handleIndex: i, handleType: 'corner' },
      });
    }
  } else if (shape.type === 'ellipse') {
    for (const idx of [0, 16, 32, 48]) {
      if (idx < verts.length) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: verts[idx] },
          properties: { shapeId: shape.id, handleIndex: idx, handleType: 'cardinal' },
        });
      }
    }
  } else {
    const hasClosingVert = verts.length > 1 &&
      verts[0][0] === verts[verts.length - 1][0] &&
      verts[0][1] === verts[verts.length - 1][1];
    const count = hasClosingVert ? verts.length - 1 : verts.length;
    for (let i = 0; i < count; i++) {
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: verts[i] },
        properties: { shapeId: shape.id, handleIndex: i, handleType: 'vertex' },
      });
    }
  }

  return features;
}

function computeHandleDragVertices(
  shape: ShapeAnnotation,
  handleIndex: number,
  newPos: [number, number],
): [number, number][] {
  if (shape.type === 'rectangle') {
    return resizeRectCorner(shape.vertices, shape.rotation, handleIndex, newPos);
  } else if (shape.type === 'ellipse') {
    return resizeEllipseCardinal(shape.vertices, shape.rotation, handleIndex, newPos);
  } else {
    const newVerts = shape.vertices.map(v => [...v] as [number, number]);
    newVerts[handleIndex] = [...newPos] as [number, number];
    if (shape.type === 'polygon' && handleIndex === 0 && newVerts.length > 1) {
      const lastIdx = newVerts.length - 1;
      if (shape.vertices[0][0] === shape.vertices[lastIdx][0] &&
          shape.vertices[0][1] === shape.vertices[lastIdx][1]) {
        newVerts[lastIdx] = [...newPos] as [number, number];
      }
    }
    return newVerts;
  }
}

export function ShapeTools({ map, store, activeTool, setActiveTool }: ShapeToolsProps) {
  const [shapes, setShapes] = useState<ShapeAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stroke, setStroke] = useState('#1a1a1a');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid');
  const [fill, setFill] = useState('#4a90d9');
  const [fillOpacity, setFillOpacity] = useState(0.15);
  const [fillPattern, setFillPattern] = useState<FillPattern>('solid');
  const [hatchScale, setHatchScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [showDirectionArrows, setShowDirectionArrows] = useState(false);
  const [reverseDirection, setReverseDirection] = useState(false);
  const [tooltipMsg, setTooltipMsg] = useState('');

  // Drawing state refs
  const drawStartRef = useRef<[number, number] | null>(null);
  const lineVerticesRef = useRef<[number, number][]>([]);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ lng: number; lat: number } | null>(null);
  const dragShapeIdRef = useRef<string | null>(null);
  const handleDragRef = useRef<{ shapeId: string; handleIndex: number; handleType: string } | null>(null);
  const handleDraggedRef = useRef(false);
  const clipboardRef = useRef<ShapeAnnotation | null>(null);
  const altDuplicateRef = useRef(false); // true when current drag is an alt-duplicate
  const brushDrawingRef = useRef(false);
  const brushPointsRef = useRef<[number, number][]>([]);

  const isShapeTool = activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'line' || activeTool === 'pen' || activeTool === 'brush';

  // Subscribe to store
  useEffect(() => {
    return store.subscribe(setShapes);
  }, [store]);

  // Deselect when tool deactivated; pick up cross-tool selection on activation
  useEffect(() => {
    if (!isShapeTool) {
      setSelectedId(null);
      lineVerticesRef.current = [];
      drawStartRef.current = null;
    } else {
      const p = consumePending();
      if (p && (p.tool === 'rectangle' || p.tool === 'ellipse' || p.tool === 'line' || p.tool === 'pen' || p.tool === 'brush')) {
        setSelectedId(p.id);
        const shape = store.getAll().find((s) => s.id === p.id);
        if (shape) loadStyleFromShape(shape);
      }
    }
  }, [isShapeTool]);

  // Tooltip
  useEffect(() => {
    if (!isShapeTool) { setTooltipMsg(''); return; }
    if (selectedId) { setTooltipMsg(TOOLTIP_MESSAGES.selected); return; }
    if (activeTool === 'line' && lineVerticesRef.current.length > 0) {
      setTooltipMsg(TOOLTIP_MESSAGES['line-drawing']);
      return;
    }
    if (activeTool === 'pen' && lineVerticesRef.current.length > 0) {
      setTooltipMsg(TOOLTIP_MESSAGES['pen-drawing']);
      return;
    }
    setTooltipMsg(TOOLTIP_MESSAGES[activeTool!] || '');
  }, [isShapeTool, activeTool, selectedId]);

  /* ---- Sync shapes to map source ---- */
  const syncToMap = useCallback((shps: ShapeAnnotation[], selId?: string | null) => {
    if (!map) return;
    const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const currentSelId = selId !== undefined ? selId : selectedId;

    const features: GeoJSON.Feature[] = shps.map((s) => {
      const isClosed = isClosedShape(s);
      let coords = [...s.vertices];

      // Reverse vertex order for direction arrows if requested
      if (s.reverseDirection && s.showDirectionArrows) {
        coords = [...coords].reverse();
      }

      // Ensure closed ring for polygons
      if (isClosed && coords.length > 2) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([...first] as [number, number]);
        }
      }

      const geometry: GeoJSON.Geometry = isClosed && coords.length >= 4
        ? { type: 'Polygon', coordinates: [coords] }
        : { type: 'LineString', coordinates: coords };

      return {
        type: 'Feature',
        geometry,
        properties: {
          id: s.id,
          shapeType: s.type,
          stroke: s.stroke,
          strokeWidth: s.strokeWidth,
          strokeStyle: s.strokeStyle || 'solid',
          fill: s.fill,
          fillOpacity: s.fillOpacity,
          fillPattern: s.fillPattern || 'solid',
          hatchScale: (s.hatchScale ?? 1).toFixed(1),
          selected: s.id === currentSelId,
          showDirectionArrows: s.showDirectionArrows || false,
        },
      };
    });

    ensurePatternImages(map, shps);
    source.setData({ type: 'FeatureCollection', features });
  }, [map, selectedId]);

  useEffect(() => { syncToMap(shapes); }, [shapes, syncToMap]);
  useEffect(() => { syncToMap(shapes, selectedId); }, [selectedId]);

  /* ---- Preview helpers ---- */
  const setPreview = useCallback((coords: [number, number][] | null, closed = false) => {
    if (!map) return;
    const source = map.getSource('shapes-preview') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!coords || coords.length < 2) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const geom: GeoJSON.Geometry = closed && coords.length >= 4
      ? { type: 'Polygon', coordinates: [coords] }
      : { type: 'LineString', coordinates: coords };

    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: geom, properties: {} }],
    });
  }, [map]);

  const clearPreview = useCallback(() => setPreview(null), [setPreview]);

  /* ---- Handle sync ---- */
  const syncHandlesToMap = useCallback((selId: string | null, overrideVerts?: [number, number][]) => {
    if (!map) return;
    const source = map.getSource('shape-handles') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    if (!selId) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const shape = store.getAll().find(s => s.id === selId);
    if (!shape) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const features = generateHandleFeatures(shape, overrideVerts);
    source.setData({ type: 'FeatureCollection', features });
  }, [map, store]);

  /* ---- Hit testing ---- */
  const hitTestHandle = useCallback((point: maplibregl.Point): { shapeId: string; handleIndex: number; handleType: string } | null => {
    if (!map || !map.getLayer(SHAPE_HANDLE_LAYER_ID)) return null;
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [point.x - 10, point.y - 10], [point.x + 10, point.y + 10],
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: [SHAPE_HANDLE_LAYER_ID] });
    for (const f of features) {
      const shapeId = f.properties?.shapeId as string;
      const shape = store.getAll().find((s) => s.id === shapeId);
      if (shape?.locked) continue;
      return {
        shapeId,
        handleIndex: f.properties?.handleIndex as number,
        handleType: f.properties?.handleType as string,
      };
    }
    return null;
  }, [map, store]);

  const hitTestShape = useCallback((point: maplibregl.Point): string | null => {
    if (!map) return null;
    const queryLayers = SHAPE_LAYER_IDS.filter((id) => map.getLayer(id));
    if (queryLayers.length === 0) return null;
    const features = map.queryRenderedFeatures(point, { layers: queryLayers });
    const allShapes = store.getAll();
    for (const f of features) {
      const id = f.properties?.id;
      if (!id) continue;
      const shape = allShapes.find((s) => s.id === id);
      if (shape && !shape.locked) return id;
    }
    return null;
  }, [map, store]);

  // Sync handles when selection or shapes change
  useEffect(() => {
    if (!isShapeTool) {
      syncHandlesToMap(null);
      return;
    }
    syncHandlesToMap(selectedId);
  }, [isShapeTool, selectedId, shapes, syncHandlesToMap]);

  /* ---- Rectangle / Ellipse: mousedown → mousemove → mouseup ---- */
  useEffect(() => {
    if (!map || (activeTool !== 'rectangle' && activeTool !== 'ellipse')) return;

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return; // let map pan

      // Handle hit — start resizing
      const handleHit = hitTestHandle(e.point);
      if (handleHit && handleHit.shapeId === selectedId) {
        handleDragRef.current = handleHit;
        e.preventDefault();
        return;
      }

      // Check if clicking existing shape first
      const hitId = hitTestShape(e.point);
      if (hitId) {
        const shape = store.getAll().find((s) => s.id === hitId);
        if (shape) loadStyleFromShape(shape);

        // Alt+drag: duplicate the shape and drag the copy
        if (e.originalEvent.altKey && shape) {
          const dup: ShapeAnnotation = {
            ...shape,
            id: nextId(),
            vertices: shape.vertices.map(v => [...v] as [number, number]),
          };
          store.add(dup);
          setSelectedId(dup.id);
          dragShapeIdRef.current = dup.id;
          altDuplicateRef.current = true;
        } else {
          setSelectedId(hitId);
          dragShapeIdRef.current = hitId;
          altDuplicateRef.current = false;
        }
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        draggingRef.current = false;
        e.preventDefault();
        return;
      }

      // Always start drawing — cross-tool check deferred to mouseup
      setSelectedId(null);
      drawStartRef.current = [e.lngLat.lng, e.lngLat.lat];
      e.preventDefault();
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      // Handle drag (resize/reshape)
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (!shape) return;
        const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const newVertices = computeHandleDragVertices(shape, handleDragRef.current!.handleIndex, newPos);
        // Live preview shapes
        const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
        if (source) {
          const allShapes = store.getAll();
          const features: GeoJSON.Feature[] = allShapes.map((s) => {
            const verts = s.id === handleDragRef.current!.shapeId ? newVertices : s.vertices;
            const isClosed = isClosedShape(s);
            const coords = [...verts];
            if (isClosed && coords.length > 2) {
              const f = coords[0], l = coords[coords.length - 1];
              if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f] as [number, number]);
            }
            return {
              type: 'Feature',
              geometry: (isClosed && coords.length >= 4
                ? { type: 'Polygon', coordinates: [coords] }
                : { type: 'LineString', coordinates: coords }) as GeoJSON.Geometry,
              properties: {
                id: s.id, shapeType: s.type,
                stroke: s.stroke, strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle || 'solid',
                fill: s.fill, fillOpacity: s.fillOpacity, fillPattern: s.fillPattern || 'solid', hatchScale: (s.hatchScale ?? 1).toFixed(1),
                selected: s.id === handleDragRef.current!.shapeId,
              },
            };
          });
          source.setData({ type: 'FeatureCollection', features });
        }
        // Live preview handles
        syncHandlesToMap(handleDragRef.current!.shapeId, newVertices);
        return;
      }

      // Dragging existing shape
      if (dragShapeIdRef.current && dragStartRef.current) {
        draggingRef.current = true;
        const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
        if (!shape) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        const moved = translateVertices(shape.vertices, dlng, dlat);
        const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
        if (source) {
          const allShapes = store.getAll();
          const features: GeoJSON.Feature[] = allShapes.map((s) => {
            const verts = s.id === dragShapeIdRef.current ? moved : s.vertices;
            const isClosed = isClosedShape(s);
            const coords = [...verts];
            if (isClosed && coords.length > 2) {
              const f = coords[0], l = coords[coords.length - 1];
              if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f] as [number, number]);
            }
            return {
              type: 'Feature',
              geometry: (isClosed && coords.length >= 4
                ? { type: 'Polygon', coordinates: [coords] }
                : { type: 'LineString', coordinates: coords }) as GeoJSON.Geometry,
              properties: {
                id: s.id, shapeType: s.type,
                stroke: s.stroke, strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle || 'solid',
                fill: s.fill, fillOpacity: s.fillOpacity, fillPattern: s.fillPattern || 'solid', hatchScale: (s.hatchScale ?? 1).toFixed(1),
                selected: s.id === dragShapeIdRef.current,
              },
            };
          });
          source.setData({ type: 'FeatureCollection', features });
        }
        // Move handles with shape
        if (dragShapeIdRef.current === selectedId) {
          syncHandlesToMap(dragShapeIdRef.current, moved);
        }
        return;
      }

      // Drawing new shape
      if (!drawStartRef.current) return;
      const start = drawStartRef.current;
      const shift = e.originalEvent.shiftKey;
      let cur: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (activeTool === 'rectangle') {
        if (shift) cur = snapSquare(start, cur);
        setPreview(makeRectVertices(start, cur), true);
      } else {
        if (shift) cur = snapSquare(start, cur);
        const cx = (start[0] + cur[0]) / 2;
        const cy = (start[1] + cur[1]) / 2;
        let rx = Math.abs(cur[0] - start[0]) / 2;
        let ry = Math.abs(cur[1] - start[1]) / 2;
        if (shift) ({ rx, ry } = snapCircle(rx, ry, cy));
        if (rx > 0 && ry > 0) {
          setPreview(makeEllipseVertices([cx, cy], rx, ry), true);
        }
      }
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      // Finish handle drag
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (shape) {
          const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          const newVertices = computeHandleDragVertices(shape, handleDragRef.current!.handleIndex, newPos);
          store.update(handleDragRef.current!.shapeId, { vertices: newVertices });
        }
        handleDragRef.current = null;
        return;
      }

      // Finish body drag
      if (dragShapeIdRef.current && dragStartRef.current) {
        if (draggingRef.current) {
          const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
          if (shape) {
            const dlng = e.lngLat.lng - dragStartRef.current.lng;
            const dlat = e.lngLat.lat - dragStartRef.current.lat;
            store.update(dragShapeIdRef.current, {
              vertices: translateVertices(shape.vertices, dlng, dlat),
            });
          }
        }
        dragShapeIdRef.current = null;
        dragStartRef.current = null;
        draggingRef.current = false;
        return;
      }

      // Finish drawing
      if (!drawStartRef.current) return;
      const start = drawStartRef.current;
      const shift = e.originalEvent.shiftKey;
      let cur: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      drawStartRef.current = null;
      clearPreview();

      // Min size check — if too small, try cross-tool selection instead
      const dx = Math.abs(cur[0] - start[0]);
      const dy = Math.abs(cur[1] - start[1]);
      if (dx < 0.0001 && dy < 0.0001) {
        const foreign = hitTestAllTools(map, e.point);
        if (foreign && foreign.tool !== 'rectangle' && foreign.tool !== 'ellipse' && foreign.tool !== 'line') {
          setPending(foreign.tool, foreign.id);
          setActiveTool(foreign.tool);
        }
        return;
      }

      let vertices: [number, number][];
      let shapeType: ShapeAnnotation['type'];

      if (activeTool === 'rectangle') {
        if (shift) cur = snapSquare(start, cur);
        vertices = makeRectVertices(start, cur);
        shapeType = 'rectangle';
      } else {
        if (shift) cur = snapSquare(start, cur);
        const cx = (start[0] + cur[0]) / 2;
        const cy = (start[1] + cur[1]) / 2;
        let rx = Math.abs(cur[0] - start[0]) / 2;
        let ry = Math.abs(cur[1] - start[1]) / 2;
        if (shift) ({ rx, ry } = snapCircle(rx, ry, cy));
        vertices = makeEllipseVertices([cx, cy], rx, ry);
        shapeType = 'ellipse';
      }

      const shape: ShapeAnnotation = {
        id: nextId(),
        type: shapeType,
        vertices,
        rotation: 0,
        stroke,
        strokeWidth,
        strokeStyle,
        fill,
        fillOpacity,
        fillPattern,
        hatchScale,
      };

      store.add(shape);
      setSelectedId(shape.id);
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      clearPreview();
    };
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

  /* ---- Line / Polygon: click to place, right-click to finish ---- */
  useEffect(() => {
    if (!map || activeTool !== 'line') return;

    const CLOSE_THRESHOLD = 12; // px

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      if (draggingRef.current || handleDraggedRef.current) return;

      // If no vertices yet, check for existing shape click
      if (lineVerticesRef.current.length === 0) {
        const hitId = hitTestShape(e.point);
        if (hitId) {
          setSelectedId(hitId);
          const shape = store.getAll().find((s) => s.id === hitId);
          if (shape) loadStyleFromShape(shape);
          return;
        }
        // Cross-tool only when not drawing
        const foreign = hitTestAllTools(map, e.point);
        if (foreign && foreign.tool !== 'rectangle' && foreign.tool !== 'ellipse' && foreign.tool !== 'line') {
          setPending(foreign.tool, foreign.id);
          setActiveTool(foreign.tool);
          return;
        }
        if (selectedId) {
          setSelectedId(null);
          return;
        }
      }

      let pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (e.originalEvent.shiftKey && lineVerticesRef.current.length > 0) {
        pt = snapTo45(lineVerticesRef.current[lineVerticesRef.current.length - 1], pt);
      }

      if (lineVerticesRef.current.length >= 3) {
        const firstVert = lineVerticesRef.current[0];
        const firstScreen = map.project({ lng: firstVert[0], lat: firstVert[1] });
        const dist = Math.sqrt(
          (e.point.x - firstScreen.x) ** 2 + (e.point.y - firstScreen.y) ** 2,
        );
        if (dist < CLOSE_THRESHOLD) {
          const vertices = [...lineVerticesRef.current, [...lineVerticesRef.current[0]] as [number, number]];
          commitLineShape(vertices, 'polygon');
          return;
        }
      }

      lineVerticesRef.current.push(pt);
      setTooltipMsg(TOOLTIP_MESSAGES['line-drawing']);
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      // Handle drag (resize/reshape)
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (!shape) return;
        const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const newVertices = computeHandleDragVertices(shape, handleDragRef.current!.handleIndex, newPos);
        const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
        if (source) {
          const allShapes = store.getAll();
          const features: GeoJSON.Feature[] = allShapes.map((s) => {
            const verts = s.id === handleDragRef.current!.shapeId ? newVertices : s.vertices;
            const isClosed = isClosedShape(s);
            const coords = [...verts];
            if (isClosed && coords.length > 2) {
              const f = coords[0], l = coords[coords.length - 1];
              if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f] as [number, number]);
            }
            return {
              type: 'Feature',
              geometry: (isClosed && coords.length >= 4
                ? { type: 'Polygon', coordinates: [coords] }
                : { type: 'LineString', coordinates: coords }) as GeoJSON.Geometry,
              properties: {
                id: s.id, shapeType: s.type,
                stroke: s.stroke, strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle || 'solid',
                fill: s.fill, fillOpacity: s.fillOpacity, fillPattern: s.fillPattern || 'solid', hatchScale: (s.hatchScale ?? 1).toFixed(1),
                selected: s.id === handleDragRef.current!.shapeId,
              },
            };
          });
          source.setData({ type: 'FeatureCollection', features });
        }
        syncHandlesToMap(handleDragRef.current!.shapeId, newVertices);
        return;
      }

      // Body drag
      if (dragShapeIdRef.current && dragStartRef.current) {
        draggingRef.current = true;
        const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
        if (!shape) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        const moved = translateVertices(shape.vertices, dlng, dlat);
        const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
        if (source) {
          const allShapes = store.getAll();
          const features: GeoJSON.Feature[] = allShapes.map((s) => {
            const verts = s.id === dragShapeIdRef.current ? moved : s.vertices;
            const isClosed = isClosedShape(s);
            const coords = [...verts];
            if (isClosed && coords.length > 2) {
              const f = coords[0], l = coords[coords.length - 1];
              if (f[0] !== l[0] || f[1] !== l[1]) coords.push([...f] as [number, number]);
            }
            return {
              type: 'Feature',
              geometry: (isClosed && coords.length >= 4
                ? { type: 'Polygon', coordinates: [coords] }
                : { type: 'LineString', coordinates: coords }) as GeoJSON.Geometry,
              properties: {
                id: s.id, shapeType: s.type,
                stroke: s.stroke, strokeWidth: s.strokeWidth, strokeStyle: s.strokeStyle || 'solid',
                fill: s.fill, fillOpacity: s.fillOpacity, fillPattern: s.fillPattern || 'solid', hatchScale: (s.hatchScale ?? 1).toFixed(1),
                selected: s.id === dragShapeIdRef.current,
              },
            };
          });
          source.setData({ type: 'FeatureCollection', features });
        }
        if (dragShapeIdRef.current === selectedId) {
          syncHandlesToMap(dragShapeIdRef.current, moved);
        }
        return;
      }

      // Line preview
      if (lineVerticesRef.current.length === 0) return;
      let nextPt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      if (e.originalEvent.shiftKey) {
        const lastPt = lineVerticesRef.current[lineVerticesRef.current.length - 1];
        nextPt = snapTo45(lastPt, nextPt);
      }
      const preview = [...lineVerticesRef.current, nextPt];
      setPreview(preview, false);
    };

    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      if (lineVerticesRef.current.length < 2) {
        lineVerticesRef.current = [];
        clearPreview();
        return;
      }
      commitLineShape([...lineVerticesRef.current], 'line');
    };

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      if (lineVerticesRef.current.length > 0) return;

      // Handle hit — start resizing
      const handleHit = hitTestHandle(e.point);
      if (handleHit && handleHit.shapeId === selectedId) {
        handleDragRef.current = handleHit;
        e.preventDefault();
        return;
      }

      const hitId = hitTestShape(e.point);
      if (!hitId) return;

      // Alt+drag: duplicate and drag the copy
      if (e.originalEvent.altKey) {
        const shape = store.getAll().find((s) => s.id === hitId);
        if (shape) {
          loadStyleFromShape(shape);
          const dup: ShapeAnnotation = {
            ...shape,
            id: nextId(),
            vertices: shape.vertices.map(v => [...v] as [number, number]),
          };
          store.add(dup);
          setSelectedId(dup.id);
          dragShapeIdRef.current = dup.id;
          altDuplicateRef.current = true;
        }
      } else {
        const shape = store.getAll().find((s) => s.id === hitId);
        if (shape) loadStyleFromShape(shape);
        setSelectedId(hitId);
        dragShapeIdRef.current = hitId;
        altDuplicateRef.current = false;
      }
      dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      draggingRef.current = false;
      e.preventDefault();
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      // Finish handle drag
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (shape) {
          const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
          const newVertices = computeHandleDragVertices(shape, handleDragRef.current!.handleIndex, newPos);
          store.update(handleDragRef.current!.shapeId, { vertices: newVertices });
        }
        handleDraggedRef.current = true;
        handleDragRef.current = null;
        setTimeout(() => { handleDraggedRef.current = false; }, 50);
        return;
      }

      if (!dragShapeIdRef.current || !dragStartRef.current) return;
      if (draggingRef.current) {
        const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
        if (shape) {
          const dlng = e.lngLat.lng - dragStartRef.current.lng;
          const dlat = e.lngLat.lat - dragStartRef.current.lat;
          store.update(dragShapeIdRef.current, {
            vertices: translateVertices(shape.vertices, dlng, dlat),
          });
        }
        setTimeout(() => { draggingRef.current = false; }, 50);
      }
      dragShapeIdRef.current = null;
      dragStartRef.current = null;
    };

    map.on('click', onClick);
    map.on('mousemove', onMouseMove);
    map.on('contextmenu', onContextMenu);
    map.on('mousedown', onMouseDown);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('click', onClick);
      map.off('mousemove', onMouseMove);
      map.off('contextmenu', onContextMenu);
      map.off('mousedown', onMouseDown);
      map.off('mouseup', onMouseUp);
      clearPreview();
    };
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

  const commitLineShape = (vertices: [number, number][], type: 'line' | 'polygon') => {
    const shape: ShapeAnnotation = {
      id: nextId(),
      type,
      vertices,
      rotation: 0,
      stroke,
      strokeWidth,
      strokeStyle,
      fill,
      fillOpacity,
      fillPattern,
      hatchScale,
    };
    store.add(shape);
    setSelectedId(shape.id);
    lineVerticesRef.current = [];
    clearPreview();
    setTooltipMsg(TOOLTIP_MESSAGES.selected);
  };

  /* ---- Pen tool: click to place, double-click to finish, auto-smooth ---- */
  useEffect(() => {
    if (!map || activeTool !== 'pen') return;

    map.doubleClickZoom.disable();

    const CLOSE_THRESHOLD = 12;

    const commitPen = (closed: boolean) => {
      if (lineVerticesRef.current.length < 2) return;
      let pts: [number, number][];
      if (closed) {
        const v = lineVerticesRef.current;
        // Wrap neighbors so the spline tangent is smooth through the seam
        pts = [v[v.length - 1], ...v, v[0], v[1]];
      } else {
        pts = lineVerticesRef.current;
      }
      let smoothed = sampleSpline(pts, 12);
      if (closed) {
        // Strip the extra wrapped segments and close the ring
        const segsPerSpan = 12;
        smoothed = smoothed.slice(segsPerSpan, smoothed.length - segsPerSpan);
        smoothed.push(smoothed[0]);
      }
      const shape: ShapeAnnotation = {
        id: nextId(), type: 'pen', vertices: smoothed, rotation: 0,
        stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale,
      };
      store.add(shape);
      setSelectedId(shape.id);
      lineVerticesRef.current = [];
      clearPreview();
      setTooltipMsg(TOOLTIP_MESSAGES.selected);
    };

    let lastClickTime = 0;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      if (draggingRef.current || handleDraggedRef.current) return;

      const now = Date.now();
      if (now - lastClickTime < 350 && lineVerticesRef.current.length >= 2) {
        // Double-click detected: pop the point added by the first click
        lineVerticesRef.current.pop();
        commitPen(false);
        lastClickTime = 0;
        return;
      }
      lastClickTime = now;

      if (lineVerticesRef.current.length === 0) {
        const hitId = hitTestShape(e.point);
        if (hitId) {
          setSelectedId(hitId);
          const shape = store.getAll().find((s) => s.id === hitId);
          if (shape) loadStyleFromShape(shape);
          return;
        }
        const foreign = hitTestAllTools(map, e.point);
        if (foreign && foreign.tool !== 'pen') {
          setPending(foreign.tool, foreign.id);
          setActiveTool(foreign.tool);
          return;
        }
        if (selectedId) { setSelectedId(null); return; }
      }

      const pt: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (lineVerticesRef.current.length >= 3) {
        const firstVert = lineVerticesRef.current[0];
        const firstScreen = map.project({ lng: firstVert[0], lat: firstVert[1] });
        const dist = Math.sqrt((e.point.x - firstScreen.x) ** 2 + (e.point.y - firstScreen.y) ** 2);
        if (dist < CLOSE_THRESHOLD) {
          commitPen(true);
          return;
        }
      }

      lineVerticesRef.current.push(pt);
      setTooltipMsg(TOOLTIP_MESSAGES['pen-drawing']);
    };

    const onContextMenu = (e: maplibregl.MapMouseEvent) => {
      e.preventDefault();
      if (lineVerticesRef.current.length < 2) {
        lineVerticesRef.current = [];
        clearPreview();
        return;
      }
      commitPen(false);
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (!shape) return;
        const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const newVerts = [...shape.vertices];
        newVerts[handleDragRef.current.handleIndex] = newPos;
        store.update(shape.id, { vertices: newVerts });
        handleDraggedRef.current = true;
        return;
      }
      if (draggingRef.current && dragStartRef.current && dragShapeIdRef.current) {
        const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
        if (!shape) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        store.update(shape.id, { vertices: translateVertices(shape.vertices, dlng, dlat) });
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        return;
      }

      if (lineVerticesRef.current.length > 0) {
        const cursor: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const previewPts = [...lineVerticesRef.current, cursor];
        const smoothPreview = sampleSpline(previewPts, 12);
        setPreview(smoothPreview, false);
      }
    };

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld() || lineVerticesRef.current.length > 0) return;
      const handleHit = hitTestHandle(e.point);
      if (handleHit) {
        handleDragRef.current = handleHit;
        handleDraggedRef.current = false;
        map.dragPan.disable();
        return;
      }
      const hitId = hitTestShape(e.point);
      if (hitId && hitId === selectedId) {
        draggingRef.current = true;
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        dragShapeIdRef.current = hitId;
        map.dragPan.disable();
      }
    };

    const onMouseUp = () => {
      if (draggingRef.current) { draggingRef.current = false; map.dragPan.enable(); }
      if (handleDragRef.current) {
        if (handleDraggedRef.current) {
          setTimeout(() => { handleDraggedRef.current = false; }, 50);
        }
        handleDragRef.current = null;
        map.dragPan.enable();
      }
    };

    map.on('click', onClick);
    map.on('contextmenu', onContextMenu);
    map.on('mousemove', onMouseMove);
    map.on('mousedown', onMouseDown);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('click', onClick);
      map.off('contextmenu', onContextMenu);
      map.off('mousemove', onMouseMove);
      map.off('mousedown', onMouseDown);
      map.off('mouseup', onMouseUp);
      map.doubleClickZoom.enable();
      clearPreview();
    };
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

  /* ---- Brush tool: drag to paint a filled region ---- */
  useEffect(() => {
    if (!map || activeTool !== 'brush') return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld() || brushDrawingRef.current) return;
      const hitId = hitTestShape(e.point);
      if (hitId) {
        setSelectedId(hitId);
        const shape = store.getAll().find((s) => s.id === hitId);
        if (shape) loadStyleFromShape(shape);
        return;
      }
      const foreign = hitTestAllTools(map, e.point);
      if (foreign && foreign.tool !== 'brush') {
        setPending(foreign.tool, foreign.id);
        setActiveTool(foreign.tool);
        return;
      }
      if (selectedId) setSelectedId(null);
    };

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;

      const handleHit = hitTestHandle(e.point);
      if (handleHit) {
        handleDragRef.current = handleHit;
        handleDraggedRef.current = false;
        map.dragPan.disable();
        return;
      }

      const hitId = hitTestShape(e.point);
      if (hitId && hitId === selectedId) {
        draggingRef.current = true;
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        dragShapeIdRef.current = hitId;
        map.dragPan.disable();
        return;
      }

      if (hitId) return;

      brushDrawingRef.current = true;
      brushPointsRef.current = [[e.lngLat.lng, e.lngLat.lat]];
      map.dragPan.disable();
      setTooltipMsg('Drawing... release to finish');
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (handleDragRef.current) {
        const shape = store.getAll().find((s) => s.id === handleDragRef.current!.shapeId);
        if (!shape) return;
        const newPos: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        const newVerts = [...shape.vertices];
        newVerts[handleDragRef.current.handleIndex] = newPos;
        store.update(shape.id, { vertices: newVerts });
        handleDraggedRef.current = true;
        return;
      }
      if (draggingRef.current && dragStartRef.current && dragShapeIdRef.current) {
        const shape = store.getAll().find((s) => s.id === dragShapeIdRef.current);
        if (!shape) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        store.update(shape.id, { vertices: translateVertices(shape.vertices, dlng, dlat) });
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        return;
      }

      if (!brushDrawingRef.current) return;
      brushPointsRef.current.push([e.lngLat.lng, e.lngLat.lat]);

      const simplified = simplifyPath(brushPointsRef.current, 0.00001);
      setPreview(simplified, false);
    };

    const onMouseUp = () => {
      if (draggingRef.current) { draggingRef.current = false; map.dragPan.enable(); return; }
      if (handleDragRef.current) {
        if (handleDraggedRef.current) {
          setTimeout(() => { handleDraggedRef.current = false; }, 50);
        }
        handleDragRef.current = null;
        map.dragPan.enable();
        return;
      }
      if (!brushDrawingRef.current) return;
      brushDrawingRef.current = false;
      map.dragPan.enable();

      const rawPoints = brushPointsRef.current;
      brushPointsRef.current = [];
      if (rawPoints.length < 5) { clearPreview(); setTooltipMsg(TOOLTIP_MESSAGES.brush); return; }

      const simplified = simplifyPath(rawPoints, 0.00001);
      const vertices: [number, number][] = simplified;

      const shape: ShapeAnnotation = {
        id: nextId(), type: 'brush', vertices, rotation: 0,
        stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale,
      };
      store.add(shape);
      setSelectedId(shape.id);
      clearPreview();
      setTooltipMsg(TOOLTIP_MESSAGES.selected);
    };

    map.on('click', onClick);
    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('click', onClick);
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
      brushDrawingRef.current = false;
      brushPointsRef.current = [];
      clearPreview();
    };
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, fillPattern, hatchScale, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

  /* ---- Cursor + disable box zoom (Shift+drag) so Shift+click works for 45° snap ---- */
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvasContainer();
    if (!isShapeTool) {
      canvas.style.cursor = '';
      map.boxZoom.enable();
      return;
    }
    map.boxZoom.disable();
    canvas.style.cursor = isSpaceHeld() ? 'grab' : 'crosshair';

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) { canvas.style.cursor = 'grab'; return; }
      if (draggingRef.current || handleDragRef.current) { canvas.style.cursor = 'grabbing'; return; }
      if (lineVerticesRef.current.length > 0) { canvas.style.cursor = 'crosshair'; return; }
      const handleHit = hitTestHandle(e.point);
      if (handleHit) { canvas.style.cursor = 'grab'; return; }
      const hitId = hitTestShape(e.point);
      canvas.style.cursor = hitId ? 'grab' : getCrossCursor(map, e.point, activeTool!);
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    map.on('mousemove', onMove);
    return () => { map.off('mousemove', onMove); unsubSpace(); canvas.style.cursor = ''; map.boxZoom.enable(); };
  }, [map, isShapeTool, activeTool, hitTestShape, hitTestHandle]);

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    if (!isShapeTool) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'c' && selectedId) {
        e.preventDefault();
        const shape = store.getAll().find((s) => s.id === selectedId);
        if (shape) clipboardRef.current = { ...shape, vertices: shape.vertices.map(v => [...v] as [number, number]) };
      } else if (mod && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const src = clipboardRef.current;
        // Offset the paste slightly (0.005° ≈ ~500m)
        const offset = 0.005;
        const newShape: ShapeAnnotation = {
          ...src,
          id: `shp_${++pasteCounter}_${Date.now()}`,
          vertices: src.vertices.map(([x, y]) => [x + offset, y - offset] as [number, number]),
        };
        store.add(newShape);
        setSelectedId(newShape.id);
        loadStyleFromShape(newShape);
      } else if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); store.undo();
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault(); store.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && lineVerticesRef.current.length > 0) {
        // Remove last point during polygon/line drawing
        e.preventDefault();
        lineVerticesRef.current.pop();
        if (lineVerticesRef.current.length === 0) {
          clearPreview();
          setTooltipMsg(TOOLTIP_MESSAGES[activeTool!] || '');
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        store.remove(selectedId);
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        if (lineVerticesRef.current.length > 0) {
          lineVerticesRef.current = [];
          clearPreview();
          setTooltipMsg(TOOLTIP_MESSAGES[activeTool!] || '');
        } else {
          setSelectedId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isShapeTool, store, selectedId, activeTool, clearPreview]);

  /* ---- Style helpers ---- */
  const loadStyleFromShape = (shape: ShapeAnnotation) => {
    setStroke(shape.stroke);
    setStrokeWidth(shape.strokeWidth);
    setStrokeStyle(shape.strokeStyle || 'solid');
    setFill(shape.fill);
    setFillOpacity(shape.fillOpacity);
    setFillPattern(shape.fillPattern || 'solid');
    setHatchScale(shape.hatchScale ?? 1.0);
    setRotation(shape.rotation || 0);
    setShowDirectionArrows(shape.showDirectionArrows || false);
    setReverseDirection(shape.reverseDirection || false);
  };

  const applyStyle = (changes: Partial<ShapeAnnotation>) => {
    if (selectedId) store.update(selectedId, changes);
  };

  const selectedShape = shapes.find((s) => s.id === selectedId);

  /* ---- Tooltip overlay ---- */
  useEffect(() => {
    if (!map || !isShapeTool) return; // inactive: don't touch shared tooltip
    const container = map.getContainer();
    let tip = container.querySelector('.map-tooltip') as HTMLDivElement | null;

    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'map-tooltip';
      container.appendChild(tip);
    }

    tip.textContent = tooltipMsg;
    tip.style.display = tooltipMsg ? 'block' : 'none';

    return () => {
      if (tip) tip.style.display = 'none';
    };
  }, [map, isShapeTool, tooltipMsg]);

  /* ---- Render ---- */
  return (
    <div className="drawing-tools" style={{ marginTop: 6 }}>
      {/* Tool buttons */}
      {SHAPE_TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`tool-btn ${activeTool === tool.id ? 'tool-btn-active' : ''}`}
          onClick={() => {
            if (activeTool === tool.id) {
              setActiveTool(null);
            } else {
              lineVerticesRef.current = [];
              drawStartRef.current = null;
              setActiveTool(tool.id);
            }
          }}
          title={`${tool.label} tool`}
        >
          <svg
            viewBox="0 0 20 20"
            width="16"
            height="16"
            dangerouslySetInnerHTML={{ __html: tool.icon }}
          />
          <span>{tool.label}</span>
          {activeTool !== tool.id && shapes.filter((s) =>
            tool.id === 'line'
              ? s.type === 'line' || s.type === 'polygon'
              : s.type === tool.id,
          ).length > 0 && (
            <span className="tool-badge">
              {shapes.filter((s) =>
                tool.id === 'line'
                  ? s.type === 'line' || s.type === 'polygon'
                  : s.type === tool.id,
              ).length}
            </span>
          )}
        </button>
      ))}

      {/* Unlock all — shown when locked shapes exist */}
      {isShapeTool && shapes.some(s => s.locked) && !selectedShape && (
        <button
          className="action-btn"
          style={{ fontSize: 11, marginTop: 6, width: '100%', background: '#e67e22', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}
          onClick={() => shapes.filter(s => s.locked).forEach(s => store.update(s.id, { locked: false }))}
        >
          Unlock all shapes ({shapes.filter(s => s.locked).length})
        </button>
      )}

      {/* Controls — shown when a shape tool is active */}
      {isShapeTool && (
        <div className="text-style-controls">
          {/* Selection bar */}
          {selectedShape ? (
            <div className="selection-bar">
              <span className="selection-text">
                {({ pen: 'Curves', brush: 'Free Hand' } as Record<string, string>)[selectedShape.type] || selectedShape.type.charAt(0).toUpperCase() + selectedShape.type.slice(1)}
              </span>
              <div className="selection-actions">
                <button
                  className={`icon-btn ${selectedShape.locked ? 'icon-btn-locked' : 'icon-btn-lock'}`}
                  onClick={() => { store.update(selectedShape.id, { locked: !selectedShape.locked }); if (!selectedShape.locked) setSelectedId(null); }}
                  title={selectedShape.locked ? 'Unlock' : 'Lock'}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    {selectedShape.locked ? (
                      <path d="M4 7V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h1zm2 0h4V5a2 2 0 10-4 0v2zm2 3a1 1 0 100 2 1 1 0 000-2z"/>
                    ) : (
                      <path d="M10 7V5a2 2 0 10-4 0v1H4V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h7zm-2 3a1 1 0 100 2 1 1 0 000-2z"/>
                    )}
                  </svg>
                </button>
                <button
                  className="icon-btn icon-btn-danger"
                  onClick={() => { store.remove(selectedShape.id); setSelectedId(null); }}
                  title="Delete (Del)"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    <path d="M5.5 5.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zM2 3h12v1H2V3zm3-1h6v1H5V2zm-2 3h10l-.7 9.1a1 1 0 01-1 .9H6.7a1 1 0 01-1-.9L5 5h-.5z"/>
                  </svg>
                </button>
                <button
                  className="action-btn"
                  onClick={() => setSelectedId(null)}
                  title="Deselect (Esc)"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="hint-bar">
              {activeTool === 'line'
                ? 'Click to start drawing · Shift to snap 45°'
                : `Click and drag to draw · Shift for ${activeTool === 'rectangle' ? 'square' : 'circle'}`}
            </div>
          )}

          {/* Stroke color */}
          <div className="style-row">
            <label className="style-label">Stroke</label>
            <div className="color-swatches">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  className={`color-swatch ${stroke === c.value ? 'color-swatch-active' : ''}`}
                  style={{ background: c.value, borderColor: c.value === '#ffffff' ? '#ccc' : c.value }}
                  onClick={() => { setStroke(c.value); applyStyle({ stroke: c.value }); }}
                  title={c.label}
                />
              ))}
              <ColorPickerPopover
                color={stroke}
                onChange={(v) => { setStroke(v); applyStyle({ stroke: v }); }}
                presetColors={COLORS}
              />
            </div>
          </div>

          {/* Stroke width */}
          <div className="style-row">
            <label className="style-label">Width</label>
            <input
              type="range"
              min="0"
              max="8"
              step="0.5"
              value={strokeWidth}
              onChange={(e) => {
                const val = Number(e.target.value);
                setStrokeWidth(val);
                applyStyle({ strokeWidth: val });
              }}
              className="style-slider"
            />
            <span className="style-value">{strokeWidth}px</span>
          </div>

          {/* Stroke style (solid / dashed / dotted) */}
          <div className="style-row">
            <label className="style-label">Dash</label>
            <div className="stroke-style-toggle">
              {([
                { id: 'solid', label: 'Solid', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2"/>' },
                { id: 'dashed', label: 'Dashed', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="6,4"/>' },
                { id: 'dotted', label: 'Dotted', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="2,4" stroke-linecap="round"/>' },
              ] as { id: StrokeStyle; label: string; svg: string }[]).map((opt) => (
                <button
                  key={opt.id}
                  className={`stroke-style-btn ${strokeStyle === opt.id ? 'stroke-style-btn-on' : ''}`}
                  onClick={() => { setStrokeStyle(opt.id); applyStyle({ strokeStyle: opt.id }); }}
                  title={opt.label}
                >
                  <svg viewBox="0 0 32 16" width="32" height="16" dangerouslySetInnerHTML={{ __html: opt.svg }} />
                </button>
              ))}
            </div>
          </div>

          {/* Fill color (for closed shapes) */}
          {activeTool !== 'line' || (selectedShape && selectedShape.type === 'polygon') ? (
            <>
              <div className="style-row">
                <label className="style-label">Fill</label>
                <div className="color-swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c.value}
                      className={`color-swatch ${fill === c.value ? 'color-swatch-active' : ''}`}
                      style={{ background: c.value, borderColor: c.value === '#ffffff' ? '#ccc' : c.value }}
                      onClick={() => { setFill(c.value); applyStyle({ fill: c.value }); }}
                      title={c.label}
                    />
                  ))}
                  <ColorPickerPopover
                    color={fill}
                    onChange={(v) => { setFill(v); applyStyle({ fill: v }); }}
                    presetColors={COLORS}
                  />
                </div>
              </div>

              <div className="style-row">
                <label className="style-label">Pattern</label>
                <div className="stroke-style-options">
                  {([
                    { value: 'solid' as FillPattern, label: 'Solid', svg: '<rect x="2" y="2" width="28" height="12" fill="currentColor" opacity="0.3"/>' },
                    { value: 'hatch' as FillPattern, label: 'Hatch', svg: '<rect x="2" y="2" width="28" height="12" fill="currentColor" opacity="0.08"/><line x1="4" y1="14" x2="10" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="10" y1="14" x2="16" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="16" y1="14" x2="22" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="22" y1="14" x2="28" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/>' },
                    { value: 'crosshatch' as FillPattern, label: 'Cross-hatch', svg: '<rect x="2" y="2" width="28" height="12" fill="currentColor" opacity="0.08"/><line x1="4" y1="14" x2="10" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="10" y1="14" x2="16" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="16" y1="14" x2="22" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="22" y1="14" x2="28" y2="2" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="4" y1="2" x2="10" y2="14" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="10" y1="2" x2="16" y2="14" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="16" y1="2" x2="22" y2="14" stroke="currentColor" stroke-width="1" opacity="0.5"/><line x1="22" y1="2" x2="28" y2="14" stroke="currentColor" stroke-width="1" opacity="0.5"/>' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      className={`stroke-style-btn ${fillPattern === opt.value ? 'stroke-style-btn-active' : ''}`}
                      onClick={() => { setFillPattern(opt.value); applyStyle({ fillPattern: opt.value }); }}
                      title={opt.label}
                    >
                      <svg viewBox="0 0 32 16" width="32" height="16" dangerouslySetInnerHTML={{ __html: opt.svg }} />
                    </button>
                  ))}
                </div>
              </div>

              {fillPattern !== 'solid' && (
                <div className="style-row">
                  <label className="style-label">Scale</label>
                  <input
                    type="range"
                    min="0.3"
                    max="3"
                    step="0.1"
                    value={hatchScale}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setHatchScale(val);
                      applyStyle({ hatchScale: val });
                    }}
                    className="style-slider"
                  />
                  <span className="style-value">{hatchScale.toFixed(1)}x</span>
                </div>
              )}

              <div className="style-row">
                <label className="style-label">Opacity</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={fillOpacity}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setFillOpacity(val);
                    applyStyle({ fillOpacity: val });
                  }}
                  className="style-slider"
                />
                <span className="style-value">{Math.round(fillOpacity * 100)}%</span>
              </div>
            </>
          ) : null}

          {/* Rotation (only when a shape is selected) */}
          {selectedShape && (
            <div className="style-row">
              <label className="style-label">Rotate</label>
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={rotation}
                onChange={(e) => {
                  const newRot = Number(e.target.value);
                  const delta = newRot - rotation;
                  if (delta === 0) return;
                  setRotation(newRot);
                  if (selectedId) {
                    const shape = store.getAll().find((s) => s.id === selectedId);
                    if (shape) {
                      const center = getCentroid(shape.vertices);
                      const newVerts = rotateVertices(shape.vertices, center, delta);
                      store.update(selectedId, { vertices: newVerts, rotation: newRot });
                    }
                  }
                }}
                className="style-slider"
              />
              <NumericInput
                value={rotation}
                min={-180}
                max={180}
                unit="°"
                onChange={(newRot) => {
                  const delta = newRot - rotation;
                  if (delta === 0) return;
                  setRotation(newRot);
                  if (selectedId) {
                    const shape = store.getAll().find((s) => s.id === selectedId);
                    if (shape) {
                      const center = getCentroid(shape.vertices);
                      const newVerts = rotateVertices(shape.vertices, center, delta);
                      store.update(selectedId, { vertices: newVerts, rotation: newRot });
                    }
                  }
                }}
              />
            </div>
          )}

          {/* Direction arrows (for lines and polygons) */}
          {selectedShape && (selectedShape.type === 'line' || selectedShape.type === 'polygon') && (
            <div style={{ marginTop: 6 }}>
              <label className="layer-toggle">
                <input
                  type="checkbox"
                  checked={showDirectionArrows}
                  onChange={(e) => {
                    setShowDirectionArrows(e.target.checked);
                    applyStyle({ showDirectionArrows: e.target.checked });
                  }}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
                <span className="toggle-label">Direction arrows</span>
              </label>
              {showDirectionArrows && (
                <label className="layer-toggle" style={{ marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={reverseDirection}
                    onChange={(e) => {
                      setReverseDirection(e.target.checked);
                      applyStyle({ reverseDirection: e.target.checked });
                    }}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                  <span className="toggle-label">Reverse direction</span>
                </label>
              )}
            </div>
          )}

          {/* Undo / Redo */}
          <div className="undo-redo-row">
            <button className="action-btn" onClick={() => store.undo()} disabled={!store.canUndo} title="Undo (Ctrl+Z)">
              ↩ Undo
            </button>
            <button className="action-btn" onClick={() => store.redo()} disabled={!store.canRedo} title="Redo (Ctrl+Shift+Z)">
              Redo ↪
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
