import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { MarkerStore } from '../markers';
import type { MarkerAnnotation, MarkerShape } from '../markers';
import { MARKER_LAYER_ID } from './MapView';
import type { ActiveTool } from './Sidebar';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import { hitTestAllTools, setPending, consumePending, getCrossCursor } from '../crossSelect';
import { ColorPickerPopover } from './ColorPickerPopover';

interface MarkerToolsProps {
  map: maplibregl.Map | null;
  store: MarkerStore;
  activeTool: ActiveTool;
  setActiveTool: (tool: ActiveTool) => void;
}

const SHAPES: { id: MarkerShape; label: string; svg: string }[] = [
  {
    id: 'circle',
    label: 'Circle',
    svg: '<circle cx="10" cy="10" r="6" fill="currentColor"/>',
  },
  {
    id: 'square',
    label: 'Square',
    svg: '<rect x="4" y="4" width="12" height="12" fill="currentColor"/>',
  },
  {
    id: 'triangle',
    label: 'Triangle',
    svg: '<polygon points="10,3 17,17 3,17" fill="currentColor"/>',
  },
  {
    id: 'pin',
    label: 'Map Pin',
    svg: '<path d="M10 2a5.5 5.5 0 00-5.5 5.5C4.5 11.5 10 18 10 18s5.5-6.5 5.5-10.5A5.5 5.5 0 0010 2zm0 7.5a2 2 0 110-4 2 2 0 010 4z" fill="currentColor"/>',
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
function nextId() { return `mkr_${++idCounter}_${Date.now()}`; }

export function MarkerTools({ map, store, activeTool, setActiveTool }: MarkerToolsProps) {
  const active = activeTool === 'marker';
  const [markers, setMarkers] = useState<MarkerAnnotation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [shape, setShape] = useState<MarkerShape>('pin');
  const [color, setColor] = useState('#c0392b');
  const [size, setSize] = useState(1);
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ lng: number; lat: number } | null>(null);
  const altDuplicateRef = useRef(false);
  const clipboardRef = useRef<MarkerAnnotation | null>(null);

  // Subscribe to store
  useEffect(() => {
    return store.subscribe(setMarkers);
  }, [store]);

  // Deselect when tool deactivated; pick up cross-tool selection on activation
  useEffect(() => {
    if (!active) { setSelectedId(null); return; }
    const p = consumePending();
    if (p && p.tool === 'marker') {
      setSelectedId(p.id);
      const mkr = store.getAll().find((m) => m.id === p.id);
      if (mkr) loadStyleFromMarker(mkr);
    }
  }, [active]);

  /* ---- Sync markers to map source ---- */
  const syncToMap = useCallback((mkrs: MarkerAnnotation[], selId?: string | null) => {
    if (!map) return;
    const source = map.getSource('markers') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const currentSelId = selId !== undefined ? selId : selectedId;

    source.setData({
      type: 'FeatureCollection',
      features: mkrs.map((m) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
        properties: {
          id: m.id,
          markerShape: `marker-${m.shape}`,
          color: m.color,
          size: m.size,
          selected: m.id === currentSelId,
        },
      })),
    });
  }, [map, selectedId]);

  useEffect(() => { syncToMap(markers); }, [markers, syncToMap]);
  useEffect(() => { syncToMap(markers, selectedId); }, [selectedId]);

  /* ---- Click to place / select ---- */
  useEffect(() => {
    if (!map || !active) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      if (draggingRef.current) return;

      // Hit test existing marker
      const layer = map.getLayer(MARKER_LAYER_ID) ? MARKER_LAYER_ID : null;
      if (layer) {
        const features = map.queryRenderedFeatures(e.point, { layers: [layer] });
        const allMkrs = store.getAll();
        const hit = features.find(f => {
          const m = allMkrs.find(m => m.id === f.properties?.id);
          return m && !m.locked;
        });
        if (hit) {
          const id = hit.properties?.id;
          if (id) {
            setSelectedId(id);
            const mkr = allMkrs.find((m) => m.id === id);
            if (mkr) loadStyleFromMarker(mkr);
          }
          return;
        }
      }

      // Check if clicking on another tool's element
      const foreign = hitTestAllTools(map, e.point);
      if (foreign && foreign.tool !== 'marker') {
        setPending(foreign.tool, foreign.id);
        setActiveTool(foreign.tool);
        return;
      }

      // If something is selected, deselect on empty-map click
      if (selectedId) {
        setSelectedId(null);
        return;
      }

      // Place new marker
      const marker: MarkerAnnotation = {
        id: nextId(),
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        shape,
        color,
        size,
      };
      store.add(marker);
      setSelectedId(marker.id);
    };

    map.on('click', handleClick);
    return () => { map.off('click', handleClick); };
  }, [map, active, store, selectedId, shape, color, size]);

  /* ---- Drag to move ---- */
  useEffect(() => {
    if (!map || !active) return;

    let dragId: string | null = null;

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      const layer = map.getLayer(MARKER_LAYER_ID) ? MARKER_LAYER_ID : null;
      if (!layer) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [layer] });
      if (features.length === 0) return;

      const allMkrs = store.getAll();
      const hit = features.find(f => {
        const m = allMkrs.find(m => m.id === f.properties?.id);
        return m && !m.locked;
      });
      if (!hit) return;
      const id = hit.properties?.id;
      if (!id) return;

      // Alt+drag: duplicate the marker and drag the copy
      if (e.originalEvent.altKey) {
        const orig = store.getAll().find((m) => m.id === id);
        if (orig) {
          const dupeId = nextId();
          const dupe: MarkerAnnotation = { ...orig, id: dupeId };
          store.add(dupe);
          dragId = dupeId;
          altDuplicateRef.current = true;
        }
      } else {
        dragId = id;
        altDuplicateRef.current = false;
      }
      draggingRef.current = false;
      dragStartRef.current = { lng: e.lngLat.lng, lat: e.lngLat.lat };
      map.getCanvasContainer().style.cursor = 'grabbing';
      e.preventDefault();
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!dragId || !dragStartRef.current) return;
      draggingRef.current = true;

      const mkr = store.getAll().find((m) => m.id === dragId);
      if (!mkr) return;
      const dlng = e.lngLat.lng - dragStartRef.current.lng;
      const dlat = e.lngLat.lat - dragStartRef.current.lat;

      // Live preview
      const source = map.getSource('markers') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const all = store.getAll();
      source.setData({
        type: 'FeatureCollection',
        features: all.map((m) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: m.id === dragId
              ? [mkr.lng + dlng, mkr.lat + dlat]
              : [m.lng, m.lat],
          },
          properties: {
            id: m.id,
            markerShape: `marker-${m.shape}`,
            color: m.color,
            size: m.size,
            selected: m.id === dragId,
          },
        })),
      });
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (!dragId || !dragStartRef.current) return;
      if (draggingRef.current) {
        const mkr = store.getAll().find((m) => m.id === dragId);
        if (mkr) {
          const dlng = e.lngLat.lng - dragStartRef.current.lng;
          const dlat = e.lngLat.lat - dragStartRef.current.lat;
          store.update(dragId, { lng: mkr.lng + dlng, lat: mkr.lat + dlat });
        }
        setTimeout(() => { draggingRef.current = false; }, 50);
      }
      setSelectedId(dragId);
      const mkr = store.getAll().find((m) => m.id === dragId);
      if (mkr) loadStyleFromMarker(mkr);
      dragId = null;
      dragStartRef.current = null;
      map.getCanvasContainer().style.cursor = 'crosshair';
    };

    map.on('mousedown', onMouseDown);
    map.on('mousemove', onMouseMove);
    map.on('mouseup', onMouseUp);

    return () => {
      map.off('mousedown', onMouseDown);
      map.off('mousemove', onMouseMove);
      map.off('mouseup', onMouseUp);
    };
  }, [map, active, store]);

  /* ---- Cursor ---- */
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvasContainer();
    if (!active) { canvas.style.cursor = ''; return; }
    canvas.style.cursor = isSpaceHeld() ? 'grab' : 'crosshair';

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) { canvas.style.cursor = 'grab'; return; }
      if (draggingRef.current) return;
      const layer = map.getLayer(MARKER_LAYER_ID) ? MARKER_LAYER_ID : null;
      if (layer) {
        const features = map.queryRenderedFeatures(e.point, { layers: [layer] });
        const unlocked = features.filter(f => {
          const m = store.getAll().find(m => m.id === f.properties?.id);
          return m && !m.locked;
        });
        canvas.style.cursor = unlocked.length > 0 ? 'grab' : getCrossCursor(map, e.point, 'marker');
      } else {
        canvas.style.cursor = getCrossCursor(map, e.point, 'marker');
      }
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    map.on('mousemove', onMove);
    return () => { map.off('mousemove', onMove); unsubSpace(); canvas.style.cursor = ''; };
  }, [map, active]);

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
      } else if (mod && e.key === 'c' && selectedId) {
        e.preventDefault();
        const marker = store.getAll().find((m) => m.id === selectedId);
        if (marker) clipboardRef.current = { ...marker };
      } else if (mod && e.key === 'v' && clipboardRef.current) {
        e.preventDefault();
        const src = clipboardRef.current;
        const offset = 0.005;
        const pasted: MarkerAnnotation = { ...src, id: nextId(), lng: src.lng + offset, lat: src.lat - offset };
        store.add(pasted);
        setSelectedId(pasted.id);
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
  const loadStyleFromMarker = (mkr: MarkerAnnotation) => {
    setShape(mkr.shape);
    setColor(mkr.color);
    setSize(mkr.size);
  };

  const applyStyle = (changes: Partial<MarkerAnnotation>) => {
    if (selectedId) store.update(selectedId, changes);
  };

  const selectedMarker = markers.find((m) => m.id === selectedId);

  /* ---- Render ---- */
  return (
    <div className="drawing-tools" style={{ marginTop: 6 }}>
      <button
        className={`tool-btn ${active ? 'tool-btn-active' : ''}`}
        onClick={() => {
          if (active) {
            setSelectedId(null);
            setActiveTool(null);
          } else {
            setActiveTool('marker');
          }
        }}
        title="Marker tool — click on map to place markers"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
          <path d="M10 1a6 6 0 00-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 00-6-6zm0 8.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/>
        </svg>
        <span>Marker</span>
        {!active && markers.length > 0 && (
          <span className="tool-badge">{markers.length}</span>
        )}
      </button>

      {active && (
        <div className="text-style-controls">
          {/* Selection bar */}
          {selectedMarker ? (
            <div className="selection-bar">
              <span className="selection-text">
                {selectedMarker.shape.charAt(0).toUpperCase() + selectedMarker.shape.slice(1)} marker
              </span>
              <div className="selection-actions">
                <button
                  className={`icon-btn ${selectedMarker.locked ? 'icon-btn-locked' : 'icon-btn-lock'}`}
                  onClick={() => { store.update(selectedMarker.id, { locked: !selectedMarker.locked }); if (!selectedMarker.locked) setSelectedId(null); }}
                  title={selectedMarker.locked ? 'Unlock' : 'Lock'}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    {selectedMarker.locked
                      ? <path d="M4 7V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h1zm2 0h4V5a2 2 0 10-4 0v2zm2 3a1 1 0 100 2 1 1 0 000-2z"/>
                      : <path d="M10 7V5a2 2 0 10-4 0v1H4V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h7zm-2 3a1 1 0 100 2 1 1 0 000-2z"/>
                    }
                  </svg>
                </button>
                <button
                  className="icon-btn icon-btn-danger"
                  onClick={() => { store.remove(selectedMarker.id); setSelectedId(null); }}
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
            <div className="hint-bar">Click map to place a marker · Click a marker to select · Alt+drag to duplicate · Ctrl+C / Ctrl+V to copy/paste</div>
          )}

          {/* Shape picker */}
          <div className="style-row">
            <label className="style-label">Shape</label>
            <div className="marker-shape-picker">
              {SHAPES.map((s) => (
                <button
                  key={s.id}
                  className={`marker-shape-btn ${shape === s.id ? 'marker-shape-btn-on' : ''}`}
                  onClick={() => { setShape(s.id); applyStyle({ shape: s.id }); }}
                  title={s.label}
                >
                  <svg viewBox="0 0 20 20" width="18" height="18" dangerouslySetInnerHTML={{ __html: s.svg }} />
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className="style-row">
            <label className="style-label">Color</label>
            <div className="color-swatches">
              {COLORS.map((c) => (
                <button
                  key={c.value}
                  className={`color-swatch ${color === c.value ? 'color-swatch-active' : ''}`}
                  style={{ background: c.value, borderColor: c.value === '#ffffff' ? '#ccc' : c.value }}
                  onClick={() => { setColor(c.value); applyStyle({ color: c.value }); }}
                  title={c.label}
                />
              ))}
              <ColorPickerPopover
                color={color}
                onChange={(v) => { setColor(v); applyStyle({ color: v }); }}
                presetColors={COLORS}
              />
            </div>
          </div>

          {/* Size */}
          <div className="style-row">
            <label className="style-label">Size</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={size}
              onChange={(e) => {
                const val = Number(e.target.value);
                setSize(val);
                applyStyle({ size: val });
              }}
              className="style-slider"
            />
            <span className="style-value">{size.toFixed(1)}x</span>
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
