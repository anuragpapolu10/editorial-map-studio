import { useState, useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import { LayerToggles } from './LayerToggles';
import { SearchBar } from './SearchBar';
import { DrawingTools } from './DrawingTools';
import { ShapeTools } from './ShapeTools';
import { MarkerTools } from './MarkerTools';
import { ArrowTools } from './ArrowTools';
import { ExportTools } from './ExportTools';
import { LegendBuilder } from './LegendBuilder';
import { DataTools } from './DataTools';
import { ColorPickerPopover } from './ColorPickerPopover';
import { AnnotationStore } from '../annotations';
import { ShapeStore } from '../shapes';
import { MarkerStore } from '../markers';
import { ArrowStore } from '../arrows';
import { hitTestAllTools, hitTestAllToolsInBox, setPending } from '../crossSelect';
import { isSpaceHeld, subscribeSpace } from '../spacebar';
import type { StrokeStyle } from '../shapes';
import type { OverlaySettings, AspectRatio } from '../App';
import type { LegendEntry } from '../legend';
import type { HeatmapLegendInfo } from '../dataStore';

export interface SelectionItem { tool: ActiveTool; id: string }

export type ActiveTool = null | 'select' | 'text' | 'marker' | 'arrow' | 'rectangle' | 'ellipse' | 'line' | 'pen' | 'brush';

const COLORS = [
  { value: '#1a1a1a', label: 'Black' },
  { value: '#8c8c8c', label: 'Grey' },
  { value: '#ffffff', label: 'White' },
  { value: '#c0392b', label: 'Red' },
  { value: '#3a9a6b', label: 'Green' },
  { value: '#3b7dd8', label: 'Blue' },
];

type SidebarTab = 'drawing' | 'data';

interface SidebarProps {
  map: maplibregl.Map | null;
  annotationStore: AnnotationStore;
  shapeStore: ShapeStore;
  markerStore: MarkerStore;
  arrowStore: ArrowStore;
  overlay: OverlaySettings;
  setOverlay: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  legendEntries: LegendEntry[];
  setLegendEntries: React.Dispatch<React.SetStateAction<LegendEntry[]>>;
  aspectRatio: AspectRatio;
  setAspectRatio: React.Dispatch<React.SetStateAction<AspectRatio>>;
  onHeatmapLegend?: (info: HeatmapLegendInfo | null) => void;
}

export function Sidebar({ map, annotationStore, shapeStore, markerStore, arrowStore, overlay, setOverlay, legendEntries, setLegendEntries, aspectRatio, setAspectRatio, onHeatmapLegend }: SidebarProps) {
  const [activeTool, setActiveTool] = useState<ActiveTool>('select');
  const [tab, setTab] = useState<SidebarTab>('drawing');
  const [selection, setSelection] = useState<SelectionItem[]>([]);
  const selectionRef = useRef<SelectionItem[]>([]);
  selectionRef.current = selection;

  // Clear multi-selection when switching away from select tool
  useEffect(() => { if (activeTool !== 'select') setSelection([]); }, [activeTool]);

  // Delete selected items
  useEffect(() => {
    if (activeTool !== 'select') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      const sel = selectionRef.current;
      if (sel.length === 0) return;
      e.preventDefault();
      for (const item of sel) {
        if (item.tool === 'text') annotationStore.remove(item.id);
        else if (item.tool === 'marker') markerStore.remove(item.id);
        else if (item.tool === 'arrow') arrowStore.remove(item.id);
        else shapeStore.remove(item.id);
      }
      setSelection([]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeTool, annotationStore, shapeStore, markerStore, arrowStore]);

  // Select tool: click, shift+click, marquee drag
  useEffect(() => {
    if (!map || activeTool !== 'select') return;
    const canvas = map.getCanvasContainer();
    canvas.style.cursor = '';

    const container = map.getContainer();
    let tip = container.querySelector('.map-tooltip') as HTMLDivElement | null;
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'map-tooltip';
      container.appendChild(tip);
    }
    const updateTip = () => {
      if (!tip) return;
      const n = selectionRef.current.length;
      tip.textContent = n > 0
        ? `${n} item${n > 1 ? 's' : ''} selected · Shift+click to add · Delete to remove`
        : 'Click to select · Drag to box-select · Shift+click for multiple';
      tip.style.display = 'block';
    };
    updateTip();

    let marqueeDiv: HTMLDivElement | null = null;
    let dragStart: { x: number; y: number } | null = null;
    let isDragging = false;
    let didDrag = false;
    const DRAG_THRESHOLD = 5;

    const canvasRect = () => canvas.getBoundingClientRect();

    const onDomMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (isSpaceHeld()) return;
      const r = canvasRect();
      dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
      isDragging = false;
      didDrag = false;
    };

    const onDomMouseMove = (e: MouseEvent) => {
      if (!dragStart) return;
      const r = canvasRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const dx = px - dragStart.x;
      const dy = py - dragStart.y;
      if (!isDragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        isDragging = true;
        didDrag = true;
        map.dragPan.disable();
        marqueeDiv = document.createElement('div');
        marqueeDiv.className = 'select-marquee';
        container.appendChild(marqueeDiv);
      }
      if (isDragging && marqueeDiv) {
        const x = Math.min(dragStart.x, px);
        const y = Math.min(dragStart.y, py);
        const w = Math.abs(dx);
        const h = Math.abs(dy);
        const contRect = container.getBoundingClientRect();
        const offsetX = r.left - contRect.left;
        const offsetY = r.top - contRect.top;
        marqueeDiv.style.left = `${offsetX + x}px`;
        marqueeDiv.style.top = `${offsetY + y}px`;
        marqueeDiv.style.width = `${w}px`;
        marqueeDiv.style.height = `${h}px`;
      }
    };

    const onDomMouseUp = (e: MouseEvent) => {
      if (isDragging && dragStart) {
        map.dragPan.enable();
        if (marqueeDiv) { marqueeDiv.remove(); marqueeDiv = null; }
        const r = canvasRect();
        const px = e.clientX - r.left;
        const py = e.clientY - r.top;
        const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
          [Math.min(dragStart.x, px), Math.min(dragStart.y, py)],
          [Math.max(dragStart.x, px), Math.max(dragStart.y, py)],
        ];
        const hits = hitTestAllToolsInBox(map, bbox);
        const shift = e.shiftKey;
        if (shift) {
          setSelection(prev => {
            const existing = new Set(prev.map(s => s.id));
            const added = hits.filter(h => !existing.has(h.id));
            return [...prev, ...added];
          });
        } else {
          setSelection(hits);
        }
        setTimeout(updateTip, 0);
      }
      dragStart = null;
      isDragging = false;
    };

    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) { canvas.style.cursor = 'grab'; return; }
      if (!isDragging && !dragStart) {
        const hit = hitTestAllTools(map, e.point);
        canvas.style.cursor = hit ? 'pointer' : 'crosshair';
      }
    };

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (isSpaceHeld()) return;
      if (didDrag) { didDrag = false; return; }
      const shift = (e.originalEvent as MouseEvent).shiftKey;
      const hit = hitTestAllTools(map, e.point);
      if (hit) {
        if (shift) {
          setSelection(prev => {
            const idx = prev.findIndex(s => s.id === hit.id);
            if (idx >= 0) return prev.filter((_, i) => i !== idx);
            return [...prev, hit];
          });
        } else {
          setSelection([hit]);
        }
      } else if (!shift) {
        setSelection([]);
      }
      setTimeout(updateTip, 0);
    };

    const unsubSpace = subscribeSpace((held) => {
      canvas.style.cursor = held ? 'grab' : 'crosshair';
    });

    canvas.addEventListener('mousedown', onDomMouseDown);
    window.addEventListener('mousemove', onDomMouseMove);
    window.addEventListener('mouseup', onDomMouseUp);
    map.on('mousemove', onMove);
    map.on('click', onClick);
    return () => {
      unsubSpace();
      canvas.removeEventListener('mousedown', onDomMouseDown);
      window.removeEventListener('mousemove', onDomMouseMove);
      window.removeEventListener('mouseup', onDomMouseUp);
      map.off('mousemove', onMove);
      map.off('click', onClick);
      map.dragPan.enable();
      canvas.style.cursor = '';
      if (tip) tip.style.display = 'none';
      if (marqueeDiv) { marqueeDiv.remove(); marqueeDiv = null; }
    };
  }, [map, activeTool]);

  // Render selection highlights on the map
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    const highlightClass = 'select-highlight';

    const renderHighlights = () => {
      container.querySelectorAll(`.${highlightClass}`).forEach(el => el.remove());
      if (activeTool !== 'select') return;

      for (const item of selection) {
        let bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null = null;

        if (item.tool === 'text') {
          const ann = annotationStore.getAll().find(a => a.id === item.id);
          if (ann) bounds = { minLng: ann.lng, minLat: ann.lat, maxLng: ann.lng, maxLat: ann.lat };
        } else if (item.tool === 'marker') {
          const m = markerStore.getAll().find(m => m.id === item.id);
          if (m) bounds = { minLng: m.lng, minLat: m.lat, maxLng: m.lng, maxLat: m.lat };
        } else if (item.tool === 'arrow') {
          const a = arrowStore.getAll().find(a => a.id === item.id);
          if (a && a.points.length > 0) {
            const lngs = a.points.map(p => p[0]), lats = a.points.map(p => p[1]);
            bounds = { minLng: Math.min(...lngs), minLat: Math.min(...lats), maxLng: Math.max(...lngs), maxLat: Math.max(...lats) };
          }
        } else {
          const s = shapeStore.getAll().find(s => s.id === item.id);
          if (s && s.vertices.length > 0) {
            const lngs = s.vertices.map(v => v[0]), lats = s.vertices.map(v => v[1]);
            bounds = { minLng: Math.min(...lngs), minLat: Math.min(...lats), maxLng: Math.max(...lngs), maxLat: Math.max(...lats) };
          }
        }
        if (!bounds) continue;

        const pad = 0.0001;
        const tl = map.project([bounds.minLng - pad, bounds.maxLat + pad]);
        const br = map.project([bounds.maxLng + pad, bounds.minLat - pad]);
        const minDim = 20;
        let w = br.x - tl.x, h = br.y - tl.y;
        let cx = tl.x + w / 2, cy = tl.y + h / 2;
        if (w < minDim) { w = minDim; }
        if (h < minDim) { h = minDim; }

        const div = document.createElement('div');
        div.className = highlightClass;
        const canvasRect = map.getCanvasContainer().getBoundingClientRect();
        const contRect = container.getBoundingClientRect();
        const offsetX = canvasRect.left - contRect.left;
        const offsetY = canvasRect.top - contRect.top;
        div.style.left = `${offsetX + cx - w / 2 - 4}px`;
        div.style.top = `${offsetY + cy - h / 2 - 4}px`;
        div.style.width = `${w + 8}px`;
        div.style.height = `${h + 8}px`;
        container.appendChild(div);
      }
    };

    renderHighlights();
    map.on('move', renderHighlights);
    map.on('zoom', renderHighlights);
    return () => {
      map.off('move', renderHighlights);
      map.off('zoom', renderHighlights);
      container.querySelectorAll(`.${highlightClass}`).forEach(el => el.remove());
    };
  }, [map, activeTool, selection, annotationStore, shapeStore, markerStore, arrowStore]);

  // Double-click on a single selected item to switch to its tool
  useEffect(() => {
    if (!map || activeTool !== 'select') return;
    const onDblClick = (e: maplibregl.MapMouseEvent) => {
      const hit = hitTestAllTools(map, e.point);
      if (hit) {
        setPending(hit.tool, hit.id);
        setActiveTool(hit.tool);
      }
    };
    map.on('dblclick', onDblClick);
    return () => { map.off('dblclick', onDblClick); };
  }, [map, activeTool]);

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Editorial Map Studio</h1>
        <p>Clean & Simple Maps</p>
      </div>

      <div className="sidebar-section">
        <h2>Navigate</h2>
        <SearchBar map={map} shapeStore={shapeStore} markerStore={markerStore} setActiveTool={setActiveTool} />
      </div>

      <div className="sidebar-tab-bar">
        <button
          className={`sidebar-tab-btn ${tab === 'drawing' ? 'active' : ''}`}
          onClick={() => setTab('drawing')}
        >
          Drawing
        </button>
        <button
          className={`sidebar-tab-btn ${tab === 'data' ? 'active' : ''}`}
          onClick={() => setTab('data')}
        >
          Data
        </button>
      </div>

      <div style={tab !== 'drawing' ? { display: 'none' } : undefined}>
        <div className="sidebar-section">
          <h2>Layer Toggles</h2>
          <LayerToggles map={map} />
        </div>

        <div className="sidebar-section">
          <h2>Drawing Tools</h2>
          <div className="tools-grid">
            <button
              className={`tool-btn ${activeTool === 'select' ? 'tool-btn-active' : ''}`}
              onClick={() => setActiveTool(activeTool === 'select' ? null : 'select')}
              title="Select tool — click on any element to select it"
            >
              <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor">
                <path d="M5 2l10 8-5 1.5L7.5 17z"/>
              </svg>
              <span>Select</span>
            </button>
            <DrawingTools
              map={map}
              store={annotationStore}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
            />
            <MarkerTools
              map={map}
              store={markerStore}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
            />
            <ArrowTools
              map={map}
              store={arrowStore}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
            />
            <ShapeTools
              map={map}
              store={shapeStore}
              activeTool={activeTool}
              setActiveTool={setActiveTool}
            />
          </div>

          {/* Bulk properties panel for select tool */}
          {activeTool === 'select' && selection.length > 0 && (() => {
            const hasText = selection.some(s => s.tool === 'text');
            const hasMarker = selection.some(s => s.tool === 'marker');
            const hasShape = selection.some(s => s.tool === 'rectangle' || s.tool === 'ellipse' || s.tool === 'line' || s.tool === 'pen' || s.tool === 'brush');
            const hasArrow = selection.some(s => s.tool === 'arrow');
            const hasStrokeable = hasShape || hasArrow;

            const getCommonColor = (): string | null => {
              let common: string | null = null;
              for (const item of selection) {
                let c: string | undefined;
                if (item.tool === 'text') c = annotationStore.getAll().find(a => a.id === item.id)?.color;
                else if (item.tool === 'marker') c = markerStore.getAll().find(m => m.id === item.id)?.color;
                else if (item.tool === 'arrow') c = arrowStore.getAll().find(a => a.id === item.id)?.stroke;
                else c = shapeStore.getAll().find(s => s.id === item.id)?.stroke;
                if (!c) continue;
                if (common === null) common = c;
                else if (common !== c) return null;
              }
              return common;
            };

            const getCommonStrokeWidth = (): number | null => {
              let common: number | null = null;
              for (const item of selection) {
                let w: number | undefined;
                if (item.tool === 'arrow') w = arrowStore.getAll().find(a => a.id === item.id)?.strokeWidth;
                else if (item.tool !== 'text' && item.tool !== 'marker') w = shapeStore.getAll().find(s => s.id === item.id)?.strokeWidth;
                else continue;
                if (w === undefined) continue;
                if (common === null) common = w;
                else if (common !== w) return null;
              }
              return common;
            };

            const getCommonStrokeStyle = (): StrokeStyle | null => {
              let common: StrokeStyle | null = null;
              for (const item of selection) {
                let ss: StrokeStyle | undefined;
                if (item.tool === 'arrow') ss = arrowStore.getAll().find(a => a.id === item.id)?.strokeStyle;
                else if (item.tool !== 'text' && item.tool !== 'marker') ss = shapeStore.getAll().find(s => s.id === item.id)?.strokeStyle;
                else continue;
                if (!ss) continue;
                if (common === null) common = ss;
                else if (common !== ss) return null;
              }
              return common;
            };

            const getCommonFill = (): string | null => {
              let common: string | null = null;
              for (const item of selection) {
                if (item.tool === 'text' || item.tool === 'marker' || item.tool === 'arrow') continue;
                const s = shapeStore.getAll().find(s => s.id === item.id);
                if (!s) continue;
                if (common === null) common = s.fill;
                else if (common !== s.fill) return null;
              }
              return common;
            };

            const getCommonFillOpacity = (): number | null => {
              let common: number | null = null;
              for (const item of selection) {
                if (item.tool === 'text' || item.tool === 'marker' || item.tool === 'arrow') continue;
                const s = shapeStore.getAll().find(s => s.id === item.id);
                if (!s) continue;
                if (common === null) common = s.fillOpacity;
                else if (common !== s.fillOpacity) return null;
              }
              return common;
            };

            const applyColor = (color: string) => {
              for (const item of selection) {
                if (item.tool === 'text') annotationStore.update(item.id, { color });
                else if (item.tool === 'marker') markerStore.update(item.id, { color });
                else if (item.tool === 'arrow') arrowStore.update(item.id, { stroke: color });
                else shapeStore.update(item.id, { stroke: color });
              }
            };

            const applyStrokeWidth = (strokeWidth: number) => {
              for (const item of selection) {
                if (item.tool === 'arrow') arrowStore.update(item.id, { strokeWidth });
                else if (item.tool !== 'text' && item.tool !== 'marker') shapeStore.update(item.id, { strokeWidth });
              }
            };

            const applyStrokeStyle = (strokeStyle: StrokeStyle) => {
              for (const item of selection) {
                if (item.tool === 'arrow') arrowStore.update(item.id, { strokeStyle });
                else if (item.tool !== 'text' && item.tool !== 'marker') shapeStore.update(item.id, { strokeStyle });
              }
            };

            const applyFill = (fill: string) => {
              for (const item of selection) {
                if (item.tool !== 'text' && item.tool !== 'marker' && item.tool !== 'arrow') {
                  shapeStore.update(item.id, { fill });
                }
              }
            };

            const applyFillOpacity = (fillOpacity: number) => {
              for (const item of selection) {
                if (item.tool !== 'text' && item.tool !== 'marker' && item.tool !== 'arrow') {
                  shapeStore.update(item.id, { fillOpacity });
                }
              }
            };

            const commonColor = getCommonColor();
            const commonStrokeWidth = getCommonStrokeWidth();
            const commonStrokeStyle = getCommonStrokeStyle();
            const commonFill = getCommonFill();
            const commonFillOpacity = getCommonFillOpacity();

            const typeCounts: string[] = [];
            const textCount = selection.filter(s => s.tool === 'text').length;
            const markerCount = selection.filter(s => s.tool === 'marker').length;
            const arrowCount = selection.filter(s => s.tool === 'arrow').length;
            const shapeCount = selection.filter(s => s.tool !== 'text' && s.tool !== 'marker' && s.tool !== 'arrow').length;
            if (textCount) typeCounts.push(`${textCount} text`);
            if (markerCount) typeCounts.push(`${markerCount} marker${markerCount > 1 ? 's' : ''}`);
            if (arrowCount) typeCounts.push(`${arrowCount} arrow${arrowCount > 1 ? 's' : ''}`);
            if (shapeCount) typeCounts.push(`${shapeCount} shape${shapeCount > 1 ? 's' : ''}`);

            return (
              <div className="text-style-controls" style={{ marginTop: 8 }}>
                <div className="selection-bar">
                  <span className="selection-text">
                    {selection.length} selected ({typeCounts.join(', ')})
                  </span>
                  <div className="selection-actions">
                    <button
                      className="icon-btn icon-btn-danger"
                      onClick={() => {
                        for (const item of selection) {
                          if (item.tool === 'text') annotationStore.remove(item.id);
                          else if (item.tool === 'marker') markerStore.remove(item.id);
                          else if (item.tool === 'arrow') arrowStore.remove(item.id);
                          else shapeStore.remove(item.id);
                        }
                        setSelection([]);
                      }}
                      title="Delete selected (Del)"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                        <path d="M5.5 5.5a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zM2 3h12v1H2V3zm3-1h6v1H5V2zm-2 3h10l-.7 9.1a1 1 0 01-1 .9H6.7a1 1 0 01-1-.9L5 5h-.5z"/>
                      </svg>
                    </button>
                    <button
                      className="action-btn"
                      onClick={() => setSelection([])}
                      title="Clear selection (Esc)"
                    >
                      Deselect
                    </button>
                  </div>
                </div>

                {/* Color — applies to all types */}
                <div className="style-row">
                  <label className="style-label">{hasStrokeable && !hasText && !hasMarker ? 'Stroke' : 'Color'}</label>
                  <div className="color-swatches">
                    {COLORS.map((c) => (
                      <button
                        key={c.value}
                        className={`color-swatch ${commonColor === c.value ? 'color-swatch-active' : ''}`}
                        style={{ background: c.value, borderColor: c.value === '#ffffff' ? '#ccc' : c.value }}
                        onClick={() => applyColor(c.value)}
                        title={c.label}
                      />
                    ))}
                    <ColorPickerPopover
                      color={commonColor || '#1a1a1a'}
                      onChange={applyColor}
                      presetColors={COLORS}
                    />
                  </div>
                </div>

                {/* Stroke width — shapes and arrows only */}
                {hasStrokeable && (
                  <div className="style-row">
                    <label className="style-label">Width</label>
                    <input
                      type="range"
                      min="0"
                      max="8"
                      step="0.5"
                      value={commonStrokeWidth ?? 2}
                      onChange={(e) => applyStrokeWidth(Number(e.target.value))}
                      className="style-slider"
                    />
                    <span className="style-value">{commonStrokeWidth != null ? `${commonStrokeWidth}px` : 'mixed'}</span>
                  </div>
                )}

                {/* Stroke style — shapes and arrows only */}
                {hasStrokeable && (
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
                          className={`stroke-style-btn ${commonStrokeStyle === opt.id ? 'stroke-style-btn-on' : ''}`}
                          onClick={() => applyStrokeStyle(opt.id)}
                          title={opt.label}
                        >
                          <svg viewBox="0 0 32 16" width="32" height="16" dangerouslySetInnerHTML={{ __html: opt.svg }} />
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fill color — shapes only */}
                {hasShape && (
                  <div className="style-row">
                    <label className="style-label">Fill</label>
                    <div className="color-swatches">
                      {COLORS.map((c) => (
                        <button
                          key={c.value}
                          className={`color-swatch ${commonFill === c.value ? 'color-swatch-active' : ''}`}
                          style={{ background: c.value, borderColor: c.value === '#ffffff' ? '#ccc' : c.value }}
                          onClick={() => applyFill(c.value)}
                          title={c.label}
                        />
                      ))}
                      <ColorPickerPopover
                        color={commonFill || '#4a90d9'}
                        onChange={applyFill}
                        presetColors={COLORS}
                      />
                    </div>
                  </div>
                )}

                {/* Fill opacity — shapes only */}
                {hasShape && (
                  <div className="style-row">
                    <label className="style-label">Opacity</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={commonFillOpacity ?? 0.15}
                      onChange={(e) => applyFillOpacity(Number(e.target.value))}
                      className="style-slider"
                    />
                    <span className="style-value">{commonFillOpacity != null ? `${Math.round(commonFillOpacity * 100)}%` : 'mixed'}</span>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="sidebar-section">
          <h2>Legend</h2>
          <LegendBuilder entries={legendEntries} setEntries={setLegendEntries} />
        </div>
      </div>

      <div className="sidebar-section" style={tab !== 'data' ? { display: 'none' } : undefined}>
        <DataTools map={map} onHeatmapLegend={onHeatmapLegend} />
      </div>

      <div className="sidebar-section">
        <h2>Export</h2>
        <ExportTools
          map={map}
          overlay={overlay}
          setOverlay={setOverlay}
          legendEntries={legendEntries}
          annotationStore={annotationStore}
          shapeStore={shapeStore}
          markerStore={markerStore}
          arrowStore={arrowStore}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
        />
      </div>

      <div className="sidebar-footer">
        Designed by Anurag Papolu &middot; <a href="https://tally.so/r/Ek6xeN" target="_blank" rel="noopener noreferrer" className="feedback-link">Feedback</a> &middot; <a href="https://github.com/anuragpapolu10/editorial-map-studio" target="_blank" rel="noopener noreferrer" className="github-link">GitHub</a>
      </div>
    </div>
  );
}
