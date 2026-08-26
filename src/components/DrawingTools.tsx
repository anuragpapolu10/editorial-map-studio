import { useState, useEffect, useCallback, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import { AnnotationStore } from '../annotations';
import type { TextAnnotation } from '../annotations';
import { ANNOTATION_LAYER_IDS } from './MapView';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import { hitTestAllTools, setPending, consumePending, getCrossCursor } from '../crossSelect';

import type { ActiveTool } from './Sidebar';
import { ColorPickerPopover } from './ColorPickerPopover';
import { NumericInput } from './NumericInput';

interface DrawingToolsProps {
  map: maplibregl.Map | null;
  store: AnnotationStore;
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
function nextId() { return `ann_${++idCounter}_${Date.now()}`; }

export function DrawingTools({ map, store, activeTool, setActiveTool }: DrawingToolsProps) {
  const active = activeTool === 'text';
  const [fontSize, setFontSize] = useState(16);
  const fontFamily = 'sans' as const;
  const [fontWeight, setFontWeight] = useState<'normal' | 'bold'>('normal');
  const [fontStyle, setFontStyle] = useState<'normal' | 'italic'>('normal');
  const [color, setColor] = useState('#1a1a1a');
  const [rotation, setRotation] = useState(0);
  const [showBackground, setShowBackground] = useState(false);
  const [textStroke, setTextStroke] = useState<'white' | 'black' | 'none'>('white');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<TextAnnotation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const draggingRef = useRef(false);
  const dragStartRef = useRef<{ lng: number; lat: number } | null>(null);
  const altDuplicateRef = useRef(false);
  const clipboardRef = useRef<TextAnnotation | null>(null);

  // Subscribe to store
  useEffect(() => {
    return store.subscribe(setAnnotations);
  }, [store]);

  // Deselect when tool deactivated; pick up cross-tool selection on activation
  useEffect(() => {
    if (!active) {
      setSelectedId(null);
      setEditingId(null);
      setEditText('');
    } else {
      const p = consumePending();
      if (p && p.tool === 'text') {
        setSelectedId(p.id);
      }
    }
  }, [active]);

  // Deselect when tool is deactivated externally
  useEffect(() => {
    if (!active) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [active]);

  // Sync annotations to map source (include selection state)
  const syncToMap = useCallback((anns: TextAnnotation[], selId?: string | null) => {
    if (!map) return;
    const source = map.getSource('annotations') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const currentSelId = selId !== undefined ? selId : selectedId;
    source.setData({
      type: 'FeatureCollection',
      features: anns.map((a) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [a.lng, a.lat] },
        properties: {
          id: a.id,
          text: a.text,
          fontSize: a.fontSize,
          fontFamily: a.fontFamily,
          fontWeight: a.fontWeight,
          fontStyle: a.fontStyle,
          color: a.color,
          rotation: a.rotation,
          showBackground: a.showBackground,
          textStroke: a.textStroke ?? 'white',
          selected: a.id === currentSelId,
        },
      })),
    });
  }, [map, selectedId]);

  useEffect(() => { syncToMap(annotations); }, [annotations, syncToMap]);

  // Re-sync when selection changes (to update highlight)
  useEffect(() => { syncToMap(annotations, selectedId); }, [selectedId]);

  // Sync existing annotations on mount
  useEffect(() => {
    if (!map) return;
    syncToMap(store.getAll());
  }, [map, store, syncToMap]);

  // Load selected annotation's style into controls
  const loadStyleFromAnnotation = useCallback((ann: TextAnnotation) => {
    setFontSize(ann.fontSize);
    setFontWeight(ann.fontWeight);
    setFontStyle(ann.fontStyle);
    setColor(ann.color);
    setRotation(ann.rotation);
    setShowBackground(ann.showBackground);
    setTextStroke(ann.textStroke ?? ((ann as any).showStroke === false ? 'none' : 'white'));
  }, []);

  // Map click handler
  useEffect(() => {
    if (!map || !active) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return; // let map pan
      if (draggingRef.current) return;

      // Check if clicking an existing annotation
      const queryLayers = ANNOTATION_LAYER_IDS.filter((id) => map.getLayer(id));
      const features = queryLayers.length > 0
        ? map.queryRenderedFeatures(e.point, { layers: queryLayers })
        : [];

      if (features.length > 0) {
        const allAnns = store.getAll();
        const hit = features.find(f => {
          const a = allAnns.find(a => a.id === f.properties?.id);
          return a && !a.locked;
        });
        if (hit) {
          const id = hit.properties?.id;
          setSelectedId(id);
          const ann = allAnns.find((a) => a.id === id);
          if (ann) loadStyleFromAnnotation(ann);
          return;
        }
      }

      // Check if clicking on another tool's element
      const foreign = hitTestAllTools(map, e.point);
      if (foreign && foreign.tool !== 'text') {
        setPending(foreign.tool, foreign.id);
        setActiveTool(foreign.tool);
        return;
      }

      // If something is selected, deselect on empty-map click
      if (selectedId) {
        setSelectedId(null);
        setEditingId(null);
        setEditText('');
        return;
      }

      // Place new annotation
      const annotation: TextAnnotation = {
        id: nextId(),
        lng: e.lngLat.lng,
        lat: e.lngLat.lat,
        text: 'Label',
        fontSize,
        fontFamily,
        fontWeight,
        fontStyle,
        color,
        rotation,
        showBackground,
        textStroke,
      };

      store.add(annotation);
      setSelectedId(annotation.id);
      setEditingId(annotation.id);
      setEditText('Label');
    };

    const handleDblClick = (e: maplibregl.MapMouseEvent) => {
      if (draggingRef.current) return;

      const queryLayers = ANNOTATION_LAYER_IDS.filter((id) => map.getLayer(id));
      const features = queryLayers.length > 0
        ? map.queryRenderedFeatures(e.point, { layers: queryLayers })
        : [];

      if (features.length > 0) {
        const allAnns = store.getAll();
        const hit = features.find(f => {
          const a = allAnns.find(a => a.id === f.properties?.id);
          return a && !a.locked;
        });
        if (hit) {
          const id = hit.properties?.id;
          const ann = allAnns.find((a) => a.id === id);
          if (ann) {
            e.preventDefault();
            setSelectedId(id!);
            loadStyleFromAnnotation(ann);
            setEditingId(id);
            setEditText(ann.text);
          }
        }
      }
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);
    return () => { map.off('click', handleClick); map.off('dblclick', handleDblClick); };
  }, [map, active, store, selectedId, fontSize, fontFamily, fontWeight, fontStyle, color, rotation, showBackground, textStroke, loadStyleFromAnnotation]);

  // Drag to move — mousedown on annotation starts drag
  useEffect(() => {
    if (!map || !active) return;

    let dragId: string | null = null;

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return; // let map pan
      const queryLayers = ANNOTATION_LAYER_IDS.filter((id) => map.getLayer(id));
      const features = queryLayers.length > 0
        ? map.queryRenderedFeatures(e.point, { layers: queryLayers })
        : [];
      if (features.length === 0) return;

      const allAnns = store.getAll();
      const hit = features.find(f => {
        const a = allAnns.find(a => a.id === f.properties?.id);
        return a && !a.locked;
      });
      if (!hit) return;
      const id = hit.properties?.id;
      if (!id) return;

      // Alt+drag: duplicate the annotation and drag the copy
      if (e.originalEvent.altKey) {
        const orig = store.getAll().find((a) => a.id === id);
        if (orig) {
          const dupeId = nextId();
          const dupe: TextAnnotation = { ...orig, id: dupeId };
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

      // Prevent map pan during drag
      e.preventDefault();
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (!dragId || !dragStartRef.current) return;
      draggingRef.current = true;

      const ann = store.getAll().find((a) => a.id === dragId);
      if (!ann) return;

      const dlng = e.lngLat.lng - dragStartRef.current.lng;
      const dlat = e.lngLat.lat - dragStartRef.current.lat;

      // Live preview: update source directly
      const source = map.getSource('annotations') as maplibregl.GeoJSONSource | undefined;
      if (!source) return;
      const allAnns = store.getAll();
      source.setData({
        type: 'FeatureCollection',
        features: allAnns.map((a) => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: a.id === dragId
              ? [ann.lng + dlng, ann.lat + dlat]
              : [a.lng, a.lat],
          },
          properties: {
            id: a.id, text: a.text, fontSize: a.fontSize,
            fontFamily: a.fontFamily, fontWeight: a.fontWeight,
            fontStyle: a.fontStyle, color: a.color, rotation: a.rotation,
            showBackground: a.showBackground, textStroke: a.textStroke ?? 'white', selected: a.id === dragId,
          },
        })),
      });
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (!dragId || !dragStartRef.current) return;

      if (draggingRef.current) {
        const ann = store.getAll().find((a) => a.id === dragId);
        if (ann) {
          const dlng = e.lngLat.lng - dragStartRef.current.lng;
          const dlat = e.lngLat.lat - dragStartRef.current.lat;
          store.update(dragId, {
            lng: ann.lng + dlng,
            lat: ann.lat + dlat,
          });
        }
        // Prevent the click event from firing after drag
        setTimeout(() => { draggingRef.current = false; }, 50);
      }

      setSelectedId(dragId);
      const ann = store.getAll().find((a) => a.id === dragId);
      if (ann) loadStyleFromAnnotation(ann);

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
  }, [map, active, store, loadStyleFromAnnotation]);

  // Cursor: crosshair when active, grab when hovering annotations, grab when space held
  useEffect(() => {
    if (!map) return;
    const canvas = map.getCanvasContainer();

    if (!active) {
      canvas.style.cursor = '';
      return () => { canvas.style.cursor = ''; };
    }

    canvas.style.cursor = isSpaceHeld() ? 'grab' : 'crosshair';

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) { canvas.style.cursor = 'grab'; return; }
      if (draggingRef.current) return;
      const queryLayers = ANNOTATION_LAYER_IDS.filter((id) => map.getLayer(id));
      const features = queryLayers.length > 0
        ? map.queryRenderedFeatures(e.point, { layers: queryLayers })
        : [];
      const unlocked = features.filter(f => {
        const a = store.getAll().find(a => a.id === f.properties?.id);
        return a && !a.locked;
      });
      canvas.style.cursor = unlocked.length > 0 ? 'grab' : getCrossCursor(map, e.point, 'text');
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    map.on('mousemove', onMove);
    return () => {
      map.off('mousemove', onMove);
      unsubSpace();
      canvas.style.cursor = '';
    };
  }, [map, active]);

  // Keyboard shortcuts: undo/redo + delete
  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        store.undo();
      } else if (mod && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        store.redo();
      } else if (mod && e.key === 'c' && selectedId && !editingId) {
        e.preventDefault();
        const ann = store.getAll().find((a) => a.id === selectedId);
        if (ann) clipboardRef.current = { ...ann };
      } else if (mod && e.key === 'v' && clipboardRef.current && !editingId) {
        e.preventDefault();
        const src = clipboardRef.current;
        const offset = 0.005;
        const pasted: TextAnnotation = { ...src, id: nextId(), lng: src.lng + offset, lat: src.lat - offset };
        store.add(pasted);
        setSelectedId(pasted.id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && !editingId) {
        e.preventDefault();
        store.remove(selectedId);
        setSelectedId(null);
      } else if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null);
          setEditText('');
        } else {
          setSelectedId(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, store, selectedId, editingId]);

  // Apply style change to selected annotation
  const applyStyle = (changes: Partial<TextAnnotation>) => {
    if (selectedId) store.update(selectedId, changes);
  };

  const commitEdit = () => {
    if (editingId && editText.trim()) {
      store.update(editingId, { text: editText.trim() });
    } else if (editingId && !editText.trim()) {
      store.remove(editingId);
    }
    setEditingId(null);
    setEditText('');
  };

  const toggleTool = () => {
    if (active) {
      setSelectedId(null);
      setEditingId(null);
      setActiveTool(null);
    } else {
      setActiveTool('text');
    }
  };

  const selectedAnn = annotations.find((a) => a.id === selectedId);

  return (
    <div className="drawing-tools">
      {/* Tool activation */}
      <button
        className={`tool-btn ${active ? 'tool-btn-active' : ''}`}
        onClick={toggleTool}
        title="Text tool — click on map to place labels"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
          <path d="M3 4h14v3h-1.5V5.5h-5V15H12v1.5H8V15h1.5V5.5h-5V7H3V4z"/>
        </svg>
        <span>Text</span>
        {!active && annotations.length > 0 && (
          <span className="tool-badge">{annotations.length}</span>
        )}
      </button>

      {/* Controls — shown when tool is active */}
      {active && (
        <div className="text-style-controls">
          {/* Selection info bar */}
          {selectedAnn && !editingId ? (
            <div className="selection-bar">
              <span className="selection-text" title={selectedAnn.text}>
                {selectedAnn.text}
              </span>
              <div className="selection-actions">
                <button
                  className="icon-btn"
                  onClick={() => {
                    setEditingId(selectedAnn.id);
                    setEditText(selectedAnn.text);
                  }}
                  title="Edit text"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M12.1 1.5a1.5 1.5 0 012.1 2.1L5.6 12.2l-3 .8.8-3L12.1 1.5z"/></svg>
                </button>
                <button
                  className={`icon-btn ${selectedAnn.locked ? 'icon-btn-locked' : 'icon-btn-lock'}`}
                  onClick={() => { store.update(selectedAnn.id, { locked: !selectedAnn.locked }); if (!selectedAnn.locked) setSelectedId(null); }}
                  title={selectedAnn.locked ? 'Unlock' : 'Lock'}
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                    {selectedAnn.locked
                      ? <path d="M4 7V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h1zm2 0h4V5a2 2 0 10-4 0v2zm2 3a1 1 0 100 2 1 1 0 000-2z"/>
                      : <path d="M10 7V5a2 2 0 10-4 0v1H4V5a4 4 0 118 0v2h1a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V8a1 1 0 011-1h7zm-2 3a1 1 0 100 2 1 1 0 000-2z"/>
                    }
                  </svg>
                </button>
                <button
                  className="icon-btn icon-btn-danger"
                  onClick={() => { store.remove(selectedAnn.id); setSelectedId(null); }}
                  title="Delete (Del)"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5.5 5.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zM2 3h12v1H2V3zm3-1h6v1H5V2zm-2 3h10l-.7 9.1a1 1 0 01-1 .9H6.7a1 1 0 01-1-.9L5 5h-.5z"/></svg>
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
          ) : !editingId ? (
            <div className="hint-bar">Click map to place a label · Click a label to select · Alt+drag to duplicate · Ctrl+C / Ctrl+V to copy/paste</div>
          ) : null}

          {/* Inline text editing */}
          {editingId && (
            <div className="text-edit-row">
              <textarea
                className="text-edit-input"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                  if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
                }}
                onBlur={commitEdit}
                onFocus={(e) => e.target.select()}
                autoFocus
                placeholder="Type label..."
                rows={editText.split('\n').length || 1}
              />
            </div>
          )}

          {/* Font style */}
          <div className="style-row">
            <label className="style-label">Style</label>
            <div className="style-btn-group" style={{ marginLeft: 0 }}>
              <button
                className={`style-btn ${fontWeight === 'bold' ? 'style-btn-on' : ''}`}
                onClick={() => {
                  const val = fontWeight === 'bold' ? 'normal' : 'bold';
                  setFontWeight(val);
                  applyStyle({ fontWeight: val });
                }}
                title="Bold"
              >B</button>
              <button
                className={`style-btn ${fontStyle === 'italic' ? 'style-btn-on' : ''}`}
                onClick={() => {
                  const val = fontStyle === 'italic' ? 'normal' : 'italic';
                  setFontStyle(val);
                  applyStyle({ fontStyle: val });
                }}
                title="Italic"
                style={{ fontStyle: 'italic' }}
              >I</button>
              <button
                className={`style-btn ${textStroke !== 'none' ? 'style-btn-on' : ''}`}
                onClick={() => {
                  const next = textStroke === 'white' ? 'black' : textStroke === 'black' ? 'none' : 'white';
                  setTextStroke(next);
                  applyStyle({ textStroke: next });
                }}
                title={`Text outline: ${textStroke}`}
                style={{ position: 'relative' }}
              ><svg width="14" height="14" viewBox="0 0 14 14" style={{ display: 'block' }}>
                <text x="7" y="11" textAnchor="middle" fontSize="12" fontWeight="700"
                  fill={textStroke === 'none' ? 'currentColor' : textStroke === 'white' ? '#1a1a1a' : '#fff'}
                  stroke={textStroke === 'none' ? 'none' : textStroke}
                  strokeWidth={textStroke === 'none' ? 0 : 2.5}
                  paintOrder="stroke"
                >A</text>
              </svg></button>
            </div>
          </div>

          {/* Font size */}
          <div className="style-row">
            <label className="style-label">Size</label>
            <input
              type="range"
              min="10"
              max="72"
              value={fontSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                setFontSize(val);
                applyStyle({ fontSize: val });
              }}
              className="style-slider"
            />
            <NumericInput
              value={fontSize} min={10} max={72} unit="px"
              onChange={(val) => { setFontSize(val); applyStyle({ fontSize: val }); }}
            />
          </div>

          {/* Rotation */}
          <div className="style-row">
            <label className="style-label">Rotate</label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={rotation}
              onChange={(e) => {
                const val = Number(e.target.value);
                setRotation(val);
                applyStyle({ rotation: val });
              }}
              className="style-slider"
            />
            <NumericInput
              value={rotation} min={-180} max={180} unit="°"
              onChange={(val) => { setRotation(val); applyStyle({ rotation: val }); }}
            />
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
                  onClick={() => {
                    setColor(c.value);
                    applyStyle({ color: c.value });
                  }}
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

          {/* Background box toggle */}
          <div className="style-row">
            <label className="style-label">BG</label>
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={showBackground}
                onChange={() => {
                  const val = !showBackground;
                  setShowBackground(val);
                  applyStyle({ showBackground: val });
                }}
              />
              <span className="toggle-track toggle-track-small">
                <span className="toggle-thumb toggle-thumb-small" />
              </span>
              <span className="toggle-label">Background box</span>
            </label>
          </div>

          {/* Undo/redo */}
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
