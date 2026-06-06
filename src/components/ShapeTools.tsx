import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { ShapeStore } from '../shapes';
import type { ShapeAnnotation, StrokeStyle } from '../shapes';
import {
  getCentroid, rotateVertices, translateVertices,
  makeRectVertices, makeEllipseVertices,
  resizeRectCorner, resizeEllipseCardinal,
} from '../shapes';
import { SHAPE_LAYER_IDS, SHAPE_HANDLE_LAYER_ID } from './MapView';
import type { ActiveTool } from './Sidebar';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import { hitTestAllTools, setPending, consumePending } from '../crossSelect';
import { snapTo45, snapSquare, snapCircle } from '../snap';

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
  line: 'Click to place points · Shift to snap 45° · Right-click or double-click to finish · Click first point to close',
  'line-drawing': 'Click to add points · Shift to snap 45° · Delete to undo last point · Right-click or double-click to finish',
  selected: 'Drag to move · Drag handles to resize · Click Done to deselect · Alt+drag to duplicate · Ctrl+C / Ctrl+V to copy/paste · Delete to remove',
};

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
    const count = shape.type === 'polygon' && verts.length > 1 &&
      verts[0][0] === verts[verts.length - 1][0] &&
      verts[0][1] === verts[verts.length - 1][1]
      ? verts.length - 1
      : verts.length;
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
  const [rotation, setRotation] = useState(0);
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

  const isShapeTool = activeTool === 'rectangle' || activeTool === 'ellipse' || activeTool === 'line';

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
      if (p && (p.tool === 'rectangle' || p.tool === 'ellipse' || p.tool === 'line')) {
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
    setTooltipMsg(TOOLTIP_MESSAGES[activeTool!] || '');
  }, [isShapeTool, activeTool, selectedId]);

  /* ---- Sync shapes to map source ---- */
  const syncToMap = useCallback((shps: ShapeAnnotation[], selId?: string | null) => {
    if (!map) return;
    const source = map.getSource('shapes') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const currentSelId = selId !== undefined ? selId : selectedId;

    const features: GeoJSON.Feature[] = shps.map((s) => {
      const isClosed = s.type !== 'line';
      const coords = [...s.vertices];

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
          selected: s.id === currentSelId,
        },
      };
    });

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
    if (features.length === 0) return null;
    return {
      shapeId: features[0].properties?.shapeId as string,
      handleIndex: features[0].properties?.handleIndex as number,
      handleType: features[0].properties?.handleType as string,
    };
  }, [map]);

  const hitTestShape = useCallback((point: maplibregl.Point): string | null => {
    if (!map) return null;
    const queryLayers = SHAPE_LAYER_IDS.filter((id) => map.getLayer(id));
    if (queryLayers.length === 0) return null;
    const features = map.queryRenderedFeatures(point, { layers: queryLayers });
    return features.length > 0 ? (features[0].properties?.id ?? null) : null;
  }, [map]);

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
            const isClosed = s.type !== 'line';
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
                fill: s.fill, fillOpacity: s.fillOpacity,
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
            const isClosed = s.type !== 'line';
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
                fill: s.fill, fillOpacity: s.fillOpacity,
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
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

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
            const isClosed = s.type !== 'line';
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
                fill: s.fill, fillOpacity: s.fillOpacity,
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
            const isClosed = s.type !== 'line';
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
                fill: s.fill, fillOpacity: s.fillOpacity,
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
  }, [map, activeTool, store, selectedId, stroke, strokeWidth, strokeStyle, fill, fillOpacity, hitTestShape, hitTestHandle, syncHandlesToMap, setPreview, clearPreview]);

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
    };
    store.add(shape);
    setSelectedId(shape.id);
    lineVerticesRef.current = [];
    clearPreview();
    setTooltipMsg(TOOLTIP_MESSAGES.selected);
  };

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
      canvas.style.cursor = hitId ? 'grab' : 'crosshair';
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    map.on('mousemove', onMove);
    return () => { map.off('mousemove', onMove); unsubSpace(); canvas.style.cursor = ''; map.boxZoom.enable(); };
  }, [map, isShapeTool, hitTestShape, hitTestHandle]);

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
    setRotation(shape.rotation || 0);
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

      {/* Controls — shown when a shape tool is active */}
      {isShapeTool && (
        <div className="text-style-controls">
          {/* Selection bar */}
          {selectedShape ? (
            <div className="selection-bar">
              <span className="selection-text">
                {selectedShape.type.charAt(0).toUpperCase() + selectedShape.type.slice(1)}
              </span>
              <div className="selection-actions">
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
            </div>
          </div>

          {/* Stroke width */}
          <div className="style-row">
            <label className="style-label">Width</label>
            <input
              type="range"
              min="1"
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
                </div>
              </div>

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
                  const oldRot = rotation;
                  const delta = newRot - oldRot;
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
              <span className="style-value">{rotation}°</span>
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
