import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { ArrowStore, arrowToFeatures, findClosestPointOnSpline } from '../arrows';
import type { ArrowAnnotation } from '../arrows';
import type { StrokeStyle } from '../shapes';
import { ARROW_SHAFT_LAYER_IDS, ARROW_CP_HANDLE_LAYER_ID } from './MapView';
import type { ActiveTool } from './Sidebar';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import { hitTestAllTools, setPending, consumePending } from '../crossSelect';
import { snapTo45 } from '../snap';

interface ArrowToolsProps {
  map: maplibregl.Map | null;
  store: ArrowStore;
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
}

const COLORS = [
  { value: '#1a1a1a', label: 'Black' },
  { value: '#8c8c8c', label: 'Grey' },
  { value: '#ffffff', label: 'White' },
  { value: '#c0392b', label: 'Red' },
  { value: '#3a9a6b', label: 'Green' },
  { value: '#3b7dd8', label: 'Blue' },
];

let idCounter = 0;
function nextId() { return `arr_${++idCounter}_${Date.now()}`; }

export function ArrowTools({ map, store, activeTool, setActiveTool }: ArrowToolsProps) {
  const active = activeTool === 'arrow';
  const [arrows, setArrows] = useState<ArrowAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stroke, setStroke] = useState('#1a1a1a');
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [strokeStyle, setStrokeStyle] = useState<StrokeStyle>('solid');
  const [tooltipMsg, setTooltipMsg] = useState('');

  // Interaction refs
  const drawStartRef = useRef<[number, number] | null>(null);
  const dragArrowIdRef = useRef<string | null>(null);
  const dragStartRef = useRef<{ lng: number; lat: number } | null>(null);
  const hasDraggedRef = useRef(false);
  const ptDragRef = useRef<{ id: string; ptIndex: number; origPt: [number, number] } | null>(null);

  // Subscribe to store
  useEffect(() => {
    return store.subscribe(setArrows);
  }, [store]);

  // Deselect when tool deactivated; pick up cross-tool selection on activation
  useEffect(() => {
    if (!active) { setSelectedId(null); return; }
    const p = consumePending();
    if (p && p.tool === 'arrow') {
      setSelectedId(p.id);
      const arrow = store.getAll().find((a) => a.id === p.id);
      if (arrow) loadStyleFromArrow(arrow);
    }
  }, [active]);

  // Tooltip text
  useEffect(() => {
    if (!active) { setTooltipMsg(''); return; }
    if (selectedId) {
      const arrow = store.getAll().find((a) => a.id === selectedId);
      const hasBends = arrow && arrow.points.length > 2;
      setTooltipMsg(
        hasBends
          ? 'Drag handles to adjust · Click shaft to add point · Delete to remove'
          : 'Drag handles to adjust · Click shaft to add bend · Delete to remove',
      );
      return;
    }
    setTooltipMsg('Click and drag to draw an arrow · Hold Shift to snap 45°');
  }, [active, selectedId, arrows, store]);

  /* ---- Sync arrows to map source ---- */
  const syncToMap = useCallback((arrs: ArrowAnnotation[], selId?: string | null) => {
    if (!map) return;
    const source = map.getSource('arrows') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const currentSelId = selId !== undefined ? selId : selectedId;

    const features: GeoJSON.Feature[] = [];
    for (const arrow of arrs) {
      features.push(...arrowToFeatures(arrow, arrow.id === currentSelId));
    }
    source.setData({ type: 'FeatureCollection', features });
  }, [map, selectedId]);

  useEffect(() => { syncToMap(arrows); }, [arrows, syncToMap]);
  useEffect(() => { syncToMap(arrows, selectedId); }, [selectedId]);

  /* ---- Hit testing (with tolerance bbox for thin lines) ---- */
  const hitBbox = (point: maplibregl.Point, pad = 8): [maplibregl.PointLike, maplibregl.PointLike] =>
    [[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]];

  const hitTestArrow = useCallback((point: maplibregl.Point): string | null => {
    if (!map) return null;
    const queryLayers = ARROW_SHAFT_LAYER_IDS.filter((id) => map.getLayer(id));
    if (queryLayers.length === 0) return null;
    const features = map.queryRenderedFeatures(hitBbox(point), { layers: queryLayers });
    return features.length > 0 ? (features[0].properties?.id ?? null) : null;
  }, [map]);

  const hitTestCpHandle = useCallback((point: maplibregl.Point): { id: string; ptIndex: number } | null => {
    if (!map) return null;
    if (!map.getLayer(ARROW_CP_HANDLE_LAYER_ID)) return null;
    const features = map.queryRenderedFeatures(hitBbox(point, 10), { layers: [ARROW_CP_HANDLE_LAYER_ID] });
    if (features.length === 0) return null;
    const props = features[0].properties;
    if (!props?.id || props?.cpIndex === undefined) return null;
    return { id: props.id, ptIndex: Number(props.cpIndex) };
  }, [map]);

  /* ---- Preview ---- */
  const setPreview = useCallback((features: GeoJSON.Feature[]) => {
    if (!map) return;
    const source = map.getSource('arrows-preview') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: 'FeatureCollection', features });
  }, [map]);

  const clearPreview = useCallback(() => setPreview([]), [setPreview]);

  /* ---- Drawing & drag interaction ---- */
  useEffect(() => {
    if (!map || !active) return;

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;

      // 1. Hit test point handles first (if an arrow is selected)
      if (selectedId) {
        const cpHit = hitTestCpHandle(e.point);
        if (cpHit) {
          const arrow = store.getAll().find((a) => a.id === cpHit.id);
          if (arrow && cpHit.ptIndex < arrow.points.length) {
            const origPt = [...arrow.points[cpHit.ptIndex]] as [number, number];
            ptDragRef.current = { id: cpHit.id, ptIndex: cpHit.ptIndex, origPt };
            dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            map.getCanvasContainer().style.cursor = 'grabbing';
            e.preventDefault();
            return;
          }
        }
      }

      // 2. Hit test arrow shafts/heads
      const hitId = hitTestArrow(e.point);
      if (hitId) {
        // If clicking on an already-selected arrow's shaft, insert a bend point
        if (hitId === selectedId) {
          const arrow = store.getAll().find((a) => a.id === hitId);
          if (arrow) {
            const clickPt: [number, number] = [e.lngLat.lng, e.lngLat.lat];
            const { segmentIndex } = findClosestPointOnSpline(arrow.points, clickPt);
            // Insert new point after segmentIndex
            const newPoints = [...arrow.points];
            newPoints.splice(segmentIndex + 1, 0, clickPt);
            store.update(hitId, { points: newPoints });

            // Immediately start dragging the new point
            const newPtIndex = segmentIndex + 1;
            ptDragRef.current = { id: hitId, ptIndex: newPtIndex, origPt: clickPt };
            dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            map.getCanvasContainer().style.cursor = 'grabbing';
            e.preventDefault();
            return;
          }
        }

        // Select a different arrow
        setSelectedId(hitId);
        const arrow = store.getAll().find((a) => a.id === hitId);
        if (arrow) loadStyleFromArrow(arrow);
        dragArrowIdRef.current = hitId;
        dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        hasDraggedRef.current = false;
        map.getCanvasContainer().style.cursor = 'grabbing';
        e.preventDefault();
        return;
      }

      // 3. Check if clicking on another tool's element
      const foreign = hitTestAllTools(map, e.point);
      if (foreign && foreign.tool !== 'arrow') {
        setPending(foreign.tool, foreign.id);
        setActiveTool(foreign.tool);
        e.preventDefault();
        return;
      }

      // 4. Empty space: deselect + start drawing
      setSelectedId(null);
      drawStartRef.current = [e.lngLat.lng, e.lngLat.lat];
      e.preventDefault();
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      // --- Point drag ---
      if (ptDragRef.current && dragStartRef.current) {
        const arrow = store.getAll().find((a) => a.id === ptDragRef.current!.id);
        if (!arrow) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        const newPt: [number, number] = [
          ptDragRef.current.origPt[0] + dlng,
          ptDragRef.current.origPt[1] + dlat,
        ];

        // Live preview with modified point
        const tempPoints = [...arrow.points];
        tempPoints[ptDragRef.current.ptIndex] = newPt;
        const tempArrow = { ...arrow, points: tempPoints };

        const allArrows = store.getAll();
        const features: GeoJSON.Feature[] = [];
        for (const a of allArrows) {
          features.push(...arrowToFeatures(a.id === arrow.id ? tempArrow : a, a.id === selectedId));
        }
        const source = map.getSource('arrows') as maplibregl.GeoJSONSource | undefined;
        if (source) source.setData({ type: 'FeatureCollection', features });
        return;
      }

      // --- Arrow drag (move entire) ---
      if (dragArrowIdRef.current && dragStartRef.current) {
        hasDraggedRef.current = true;
        const arrow = store.getAll().find((a) => a.id === dragArrowIdRef.current);
        if (!arrow) return;
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;

        const tempArrow: ArrowAnnotation = {
          ...arrow,
          points: arrow.points.map(([x, y]) => [x + dlng, y + dlat] as [number, number]),
        };

        const allArrows = store.getAll();
        const features: GeoJSON.Feature[] = [];
        for (const a of allArrows) {
          features.push(...arrowToFeatures(
            a.id === arrow.id ? tempArrow : a,
            a.id === dragArrowIdRef.current,
          ));
        }
        const source = map.getSource('arrows') as maplibregl.GeoJSONSource | undefined;
        if (source) source.setData({ type: 'FeatureCollection', features });
        return;
      }

      // --- Drawing preview ---
      if (drawStartRef.current) {
        const start = drawStartRef.current;
        let end: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (e.originalEvent.shiftKey) end = snapTo45(start, end);

        const tempArrow: ArrowAnnotation = {
          id: 'preview',
          points: [start, end],
          stroke, strokeWidth, strokeStyle,
        };
        setPreview(arrowToFeatures(tempArrow, false));
      }
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (active) map.getCanvasContainer().style.cursor = 'crosshair';

      // --- Point drag end ---
      if (ptDragRef.current && dragStartRef.current) {
        const dlng = e.lngLat.lng - dragStartRef.current.lng;
        const dlat = e.lngLat.lat - dragStartRef.current.lat;
        const newPt: [number, number] = [
          ptDragRef.current.origPt[0] + dlng,
          ptDragRef.current.origPt[1] + dlat,
        ];
        const arrow = store.getAll().find((a) => a.id === ptDragRef.current!.id);
        if (arrow) {
          const newPoints = [...arrow.points];
          newPoints[ptDragRef.current.ptIndex] = newPt;
          store.update(ptDragRef.current.id, { points: newPoints });
        }
        ptDragRef.current = null;
        dragStartRef.current = null;
        return;
      }

      // --- Arrow drag end ---
      if (dragArrowIdRef.current && dragStartRef.current) {
        if (hasDraggedRef.current) {
          const arrow = store.getAll().find((a) => a.id === dragArrowIdRef.current);
          if (arrow) {
            const dlng = e.lngLat.lng - dragStartRef.current.lng;
            const dlat = e.lngLat.lat - dragStartRef.current.lat;
            store.update(dragArrowIdRef.current, {
              points: arrow.points.map(([x, y]) => [x + dlng, y + dlat] as [number, number]),
            });
          }
        }
        dragArrowIdRef.current = null;
        dragStartRef.current = null;
        hasDraggedRef.current = false;
        return;
      }

      // --- Drawing end ---
      if (drawStartRef.current) {
        const start = drawStartRef.current;
        let end: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (e.originalEvent.shiftKey) end = snapTo45(start, end);
        drawStartRef.current = null;
        clearPreview();

        // Min size check
        const dx = Math.abs(end[0] - start[0]);
        const dy = Math.abs(end[1] - start[1]);
        if (dx < 0.0001 && dy < 0.0001) return;

        const arrow: ArrowAnnotation = {
          id: nextId(),
          points: [start, end],
          stroke, strokeWidth, strokeStyle,
        };
        store.add(arrow);
        setSelectedId(arrow.id);
      }
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
  }, [map, active, store, selectedId, stroke, strokeWidth, strokeStyle,
      hitTestArrow, hitTestCpHandle, setPreview, clearPreview]);

  /* ---- Cursor ---- */
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvasContainer();
    if (!active) { canvas.style.cursor = ''; return; }
    canvas.style.cursor = isSpaceHeld() ? 'grab' : 'crosshair';

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) { canvas.style.cursor = 'grab'; return; }
      if (ptDragRef.current || dragArrowIdRef.current) return;
      // Point handles
      if (selectedId) {
        const cpHit = hitTestCpHandle(e.point);
        if (cpHit) { canvas.style.cursor = 'grab'; return; }
      }
      const hitId = hitTestArrow(e.point);
      if (hitId) {
        // If hovering selected arrow's shaft, show pointer (for adding bend point)
        canvas.style.cursor = hitId === selectedId ? 'pointer' : 'grab';
        return;
      }
      canvas.style.cursor = 'crosshair';
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    map.on('mousemove', onMove);
    return () => { map.off('mousemove', onMove); unsubSpace(); canvas.style.cursor = ''; };
  }, [map, active, selectedId, hitTestArrow, hitTestCpHandle]);

  /* ---- Keyboard shortcuts ---- */
  useEffect(() => {
    if (!active) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault(); store.undo();
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault(); store.redo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        store.remove(selectedId);
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, store, selectedId]);

  /* ---- Style helpers ---- */
  const loadStyleFromArrow = (arrow: ArrowAnnotation) => {
    setStroke(arrow.stroke);
    setStrokeWidth(arrow.strokeWidth);
    setStrokeStyle(arrow.strokeStyle);
  };

  const applyStyle = (changes: Partial<ArrowAnnotation>) => {
    if (selectedId) store.update(selectedId, changes);
  };

  const selectedArrow = arrows.find((a) => a.id === selectedId);

  /* ---- Tooltip overlay ---- */
  useEffect(() => {
    if (!map || !active) return; // inactive: don't touch tooltip at all
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
  }, [map, active, tooltipMsg]);

  /* ---- Render ---- */
  return (
    <div className="drawing-tools" style={{ marginTop: 6 }}>
      <button
        className={`tool-btn ${active ? 'tool-btn-active' : ''}`}
        onClick={() => {
          if (active) { setSelectedId(null); setActiveTool(null); }
          else setActiveTool('arrow');
        }}
        title="Arrow tool — click and drag to draw arrows"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="5" y1="15" x2="14" y2="6" strokeLinecap="round" />
          <polyline points="9,5 15,5 15,11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Arrow</span>
        {!active && arrows.length > 0 && (
          <span className="tool-badge">{arrows.length}</span>
        )}
      </button>

      {active && (
        <div className="text-style-controls">
          {/* Selection bar */}
          {selectedArrow ? (
            <div className="selection-bar">
              <span className="selection-text">
                Arrow{selectedArrow.points.length > 2 ? ` · ${selectedArrow.points.length - 2} bend${selectedArrow.points.length > 3 ? 's' : ''}` : ''}
              </span>
              <div className="selection-actions">
                <button
                  className="icon-btn icon-btn-danger"
                  onClick={() => { store.remove(selectedArrow.id); setSelectedId(null); }}
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
            <div className="hint-bar">Click and drag to draw an arrow · Shift to snap 45°</div>
          )}

          {/* Stroke color */}
          <div className="style-row">
            <label className="style-label">Color</label>
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
              type="range" min="1" max="8" step="0.5"
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

          {/* Stroke style */}
          <div className="style-row">
            <label className="style-label">Dash</label>
            <div className="stroke-style-toggle">
              {([
                { id: 'solid' as StrokeStyle, label: 'Solid', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2"/>' },
                { id: 'dashed' as StrokeStyle, label: 'Dashed', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="6,4"/>' },
                { id: 'dotted' as StrokeStyle, label: 'Dotted', svg: '<line x1="2" y1="8" x2="30" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="2,4" stroke-linecap="round"/>' },
              ]).map((opt) => (
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
