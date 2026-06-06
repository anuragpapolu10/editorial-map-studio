import type maplibregl from 'maplibre-gl';
import type { OverlaySettings, AspectRatio } from '../App';
import { computeScaleBar } from '../scalebar';
import type { ScaleUnit } from '../scalebar';
import type { LegendEntry } from '../legend';
import type { AnnotationStore } from '../annotations';
import type { ShapeStore } from '../shapes';
import type { MarkerStore } from '../markers';
import { ArrowStore, sampleSpline } from '../arrows';

interface ExportToolsProps {
  map: maplibregl.Map | null;
  overlay: OverlaySettings;
  setOverlay: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  legendEntries: LegendEntry[];
  annotationStore: AnnotationStore;
  shapeStore: ShapeStore;
  markerStore: MarkerStore;
  arrowStore: ArrowStore;
  aspectRatio: AspectRatio;
  setAspectRatio: React.Dispatch<React.SetStateAction<AspectRatio>>;
}

async function downloadDataUrl(dataUrl: string, filename: string) {
  // Use File System Access API (Save As dialog) when available
  if ('showSaveFilePicker' in window) {
    try {
      const ext = filename.split('.').pop() || '';
      const mimeTypes: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        svg: 'image/svg+xml', geojson: 'application/geo+json', json: 'application/json',
      };
      const accept: Record<string, string[]> = {};
      if (mimeTypes[ext]) accept[mimeTypes[ext]] = [`.${ext}`];

      const handle = await (window as any).showSaveFilePicker({
        suggestedName: filename,
        types: accept[Object.keys(accept)[0]] ? [{ description: `${ext.toUpperCase()} file`, accept }] : undefined,
      });
      const writable = await handle.createWritable();
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e: any) {
      if (e.name === 'AbortError') return; // user cancelled
      // Fall through to legacy download
    }
  }

  // Fallback: direct download
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

const ATTRIBUTION = 'Editorial Map Studio | Esri, Maxar, Earthstar Geographics | Protomaps | OpenStreetMap';

/**
 * Draw attribution text (bottom-right) onto a canvas context.
 */
function drawAttribution(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number) {
  const fontSize = 10;
  const pad = 6;
  ctx.font = `400 ${fontSize}px 'Inter', Helvetica, Arial, sans-serif`;
  const textW = ctx.measureText(ATTRIBUTION).width;

  // Semi-transparent background pill
  const bgW = textW + pad * 2;
  const bgH = fontSize + pad * 2;
  const x = canvasW - bgW - 4;
  const y = canvasH - bgH - 4;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.beginPath();
  ctx.roundRect(x, y, bgW, bgH, 3);
  ctx.fill();

  // Text
  ctx.fillStyle = '#555';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(ATTRIBUTION, x + pad, y + pad);
  ctx.textBaseline = 'alphabetic';
}

/** Sources that contain user-drawn features (not basemap) */
const FEATURE_SOURCES = new Set([
  'shapes', 'shapes-preview',
  'arrows', 'arrows-preview',
  'markers', 'annotations',
]);

/**
 * Load an image from a data URL into an HTMLImageElement.
 */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Draw title/subtitle overlay onto a canvas and return a new data URL.
 * Title uses Playfair Display (serif), subtitle uses Inter (sans-serif).
 * Respects alignment (left/center) and custom font sizes.
 */
async function compositeOverlay(
  sourceDataUrl: string,
  ov: OverlaySettings,
  format: string,
  quality?: number,
): Promise<string> {
  if (!ov.title && !ov.subtitle) return sourceDataUrl;

  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;

  // Draw the map image
  ctx.drawImage(img, 0, 0);

  const pad = 24;
  const lineGap = 6;

  // Measure text heights
  ctx.font = `700 ${ov.titleSize}px 'Playfair Display', Georgia, serif`;
  const titleMetrics = ov.title ? ctx.measureText(ov.title) : null;
  const titleH = titleMetrics
    ? titleMetrics.actualBoundingBoxAscent + titleMetrics.actualBoundingBoxDescent
    : 0;

  ctx.font = `400 ${ov.subtitleSize}px 'Inter', Helvetica, Arial, sans-serif`;
  const subtitleMetrics = ov.subtitle ? ctx.measureText(ov.subtitle) : null;
  const subtitleH = subtitleMetrics
    ? subtitleMetrics.actualBoundingBoxAscent + subtitleMetrics.actualBoundingBoxDescent
    : 0;

  const totalTextH = titleH + (ov.title && ov.subtitle ? lineGap : 0) + subtitleH;
  const bandH = totalTextH + pad * 2;

  // Semi-transparent background band
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.fillRect(0, 0, img.width, bandH);

  // Thin separator line
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bandH);
  ctx.lineTo(img.width, bandH);
  ctx.stroke();

  // Compute x position based on alignment
  const xPos = (textWidth: number) => {
    if (ov.align === 'center') return (img.width - textWidth) / 2;
    return pad; // left
  };

  let y = pad;

  // Draw title
  if (ov.title) {
    ctx.font = `700 ${ov.titleSize}px 'Playfair Display', Georgia, serif`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ov.title).width;
    ctx.fillText(ov.title, xPos(tw), y);
    y += titleH + lineGap;
  }

  // Draw subtitle
  if (ov.subtitle) {
    ctx.font = `400 ${ov.subtitleSize}px 'Inter', Helvetica, Arial, sans-serif`;
    ctx.fillStyle = '#666666';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ov.subtitle).width;
    ctx.fillText(ov.subtitle, xPos(tw), y);
  }

  return canvas.toDataURL(format, quality);
}

/**
 * Render just the title/subtitle bar on a transparent canvas (no map underneath).
 * Returns a data URL for a standalone PNG overlay.
 */
function renderTitleOverlay(ov: OverlaySettings, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const pad = 24;
  const lineGap = 6;

  // Measure text
  ctx.font = `700 ${ov.titleSize}px 'Playfair Display', Georgia, serif`;
  const titleMetrics = ov.title ? ctx.measureText(ov.title) : null;
  const titleH = titleMetrics
    ? titleMetrics.actualBoundingBoxAscent + titleMetrics.actualBoundingBoxDescent
    : 0;

  ctx.font = `400 ${ov.subtitleSize}px 'Inter', Helvetica, Arial, sans-serif`;
  const subtitleMetrics = ov.subtitle ? ctx.measureText(ov.subtitle) : null;
  const subtitleH = subtitleMetrics
    ? subtitleMetrics.actualBoundingBoxAscent + subtitleMetrics.actualBoundingBoxDescent
    : 0;

  const totalTextH = titleH + (ov.title && ov.subtitle ? lineGap : 0) + subtitleH;
  const bandH = totalTextH + pad * 2;

  // Semi-transparent white band
  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.fillRect(0, 0, width, bandH);

  // Separator line
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, bandH);
  ctx.lineTo(width, bandH);
  ctx.stroke();

  const xPos = (textWidth: number) => {
    if (ov.align === 'center') return (width - textWidth) / 2;
    return pad;
  };

  let y = pad;

  if (ov.title) {
    ctx.font = `700 ${ov.titleSize}px 'Playfair Display', Georgia, serif`;
    ctx.fillStyle = '#1a1a1a';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ov.title).width;
    ctx.fillText(ov.title, xPos(tw), y);
    y += titleH + lineGap;
  }

  if (ov.subtitle) {
    ctx.font = `400 ${ov.subtitleSize}px 'Inter', Helvetica, Arial, sans-serif`;
    ctx.fillStyle = '#666666';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(ov.subtitle).width;
    ctx.fillText(ov.subtitle, xPos(tw), y);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Draw a scale bar (bottom-right) onto an existing canvas context.
 */
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  zoom: number,
  lat: number,
  unit: ScaleUnit = 'metric',
) {
  const { widthPx, label } = computeScaleBar(zoom, lat, unit, 150);
  const pad = 16;
  const barH = 6;
  const x = canvasW - pad - widthPx;
  const y = canvasH - pad - barH - 20; // nudge above attribution

  // Bar (U-shape: top line + two end ticks)
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y + barH);
  ctx.lineTo(x, y);
  ctx.lineTo(x + widthPx, y);
  ctx.lineTo(x + widthPx, y + barH);
  ctx.stroke();

  // Label
  ctx.font = "600 11px 'Inter', Helvetica, Arial, sans-serif";
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';

  // White halo behind text
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText(label, x + widthPx, y - 3);
  ctx.fillText(label, x + widthPx, y - 3);

  // Reset
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function drawCompass(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  bearing: number,
) {
  const size = 40;
  const pad = 16;
  const cx = canvasW - pad - size / 2;
  const cy = pad + size / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-bearing * Math.PI) / 180);

  // North pointer (dark)
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.moveTo(0, -size * 0.4);
  ctx.lineTo(size * 0.1, -size * 0.05);
  ctx.lineTo(0, -size * 0.1);
  ctx.lineTo(-size * 0.1, -size * 0.05);
  ctx.closePath();
  ctx.fill();

  // South pointer (light)
  ctx.fillStyle = '#bbbbbb';
  ctx.beginPath();
  ctx.moveTo(0, size * 0.4);
  ctx.lineTo(size * 0.1, size * 0.05);
  ctx.lineTo(0, size * 0.1);
  ctx.lineTo(-size * 0.1, size * 0.05);
  ctx.closePath();
  ctx.fill();

  // Center dot
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath();
  ctx.arc(0, 0, 2, 0, Math.PI * 2);
  ctx.fill();

  // N label
  ctx.font = "700 11px 'Playfair Display', Georgia, serif";
  ctx.fillStyle = '#1a1a1a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.strokeText('N', 0, -size * 0.4 - 3);
  ctx.fillText('N', 0, -size * 0.4 - 3);

  ctx.restore();
}

/**
 * Composite scale bar onto an image data URL.
 */
async function compositeScaleBar(
  sourceDataUrl: string,
  map: maplibregl.Map,
  unit: ScaleUnit,
  format: string,
  quality?: number,
): Promise<string> {
  const img = await loadImage(sourceDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const center = map.getCenter();
  drawScaleBar(ctx, canvas.width, canvas.height, map.getZoom(), center.lat, unit);

  return canvas.toDataURL(format, quality);
}

/**
 * Draw the legend box (bottom-left) onto a canvas context.
 */
function drawLegend(
  ctx: CanvasRenderingContext2D,
  _canvasW: number,
  canvasH: number,
  entries: LegendEntry[],
) {
  if (entries.length === 0) return;

  const pad = 12;
  const rowH = 22;
  const swatchSize = 14;
  const gap = 8;
  const fontSize = 12;
  const x0 = 12; // left margin from canvas edge

  ctx.font = `500 ${fontSize}px 'Inter', Helvetica, Arial, sans-serif`;

  // Measure max label width
  let maxLabelW = 0;
  for (const e of entries) {
    const w = ctx.measureText(e.label || '—').width;
    if (w > maxLabelW) maxLabelW = w;
  }

  const boxW = pad + swatchSize + gap + maxLabelW + pad;
  const boxH = pad + entries.length * rowH - (rowH - swatchSize) + pad;
  const y0 = canvasH - 36 - boxH;

  // Background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  ctx.beginPath();
  ctx.roundRect(x0, y0, boxW, boxH, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Entries
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const ey = y0 + pad + i * rowH;
    const cx = x0 + pad + swatchSize / 2;
    const cy = ey + swatchSize / 2;
    const half = swatchSize / 2;

    const doStroke = () => {
      if (e.strokeWidth > 0) {
        ctx.globalAlpha = e.strokeOpacity;
        ctx.strokeStyle = e.strokeColor;
        ctx.lineWidth = e.strokeWidth;
        ctx.stroke();
      }
    };

    if (e.symbol === 'circle') {
      ctx.beginPath();
      ctx.arc(cx, cy, half, 0, Math.PI * 2);
      ctx.globalAlpha = e.opacity;
      ctx.fillStyle = e.color;
      ctx.fill();
      doStroke();
    } else if (e.symbol === 'square') {
      ctx.globalAlpha = e.opacity;
      ctx.fillStyle = e.color;
      ctx.fillRect(x0 + pad, ey, swatchSize, swatchSize);
      if (e.strokeWidth > 0) {
        ctx.globalAlpha = e.strokeOpacity;
        ctx.strokeStyle = e.strokeColor;
        ctx.lineWidth = e.strokeWidth;
        ctx.strokeRect(x0 + pad, ey, swatchSize, swatchSize);
      }
    } else if (e.symbol === 'triangle') {
      ctx.beginPath();
      ctx.moveTo(cx, ey);
      ctx.lineTo(x0 + pad + swatchSize, ey + swatchSize);
      ctx.lineTo(x0 + pad, ey + swatchSize);
      ctx.closePath();
      ctx.globalAlpha = e.opacity;
      ctx.fillStyle = e.color;
      ctx.fill();
      doStroke();
    } else if (e.symbol === 'pin') {
      const pr = 4;
      ctx.beginPath();
      ctx.arc(cx, ey + pr + 1, pr, Math.PI, 0);
      ctx.lineTo(cx, ey + swatchSize);
      ctx.lineTo(cx - pr, ey + pr + 1);
      ctx.closePath();
      ctx.globalAlpha = e.opacity;
      ctx.fillStyle = e.color;
      ctx.fill();
      doStroke();
    } else if (e.symbol === 'line') {
      ctx.beginPath();
      ctx.moveTo(x0 + pad, cy);
      ctx.lineTo(x0 + pad + swatchSize, cy);
      ctx.globalAlpha = e.opacity;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = Math.max(e.strokeWidth, 2);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `500 ${fontSize}px 'Inter', Helvetica, Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(e.label || '—', x0 + pad + swatchSize + gap, cy);
  }

  ctx.textBaseline = 'alphabetic';
}

/**
 * Build an SVG string with the basemap as an embedded raster image
 * and all features as vector SVG elements.
 * Includes legend and scale bar as separate SVG groups.
 */
function buildSvgExport(
  map: maplibregl.Map,
  bgDataUrl: string,
  annotationStore: AnnotationStore,
  shapeStore: ShapeStore,
  markerStore: MarkerStore,
  arrowStore: ArrowStore,
  overlay: OverlaySettings,
  legendEntries: LegendEntry[],
): string {
  const canvas = map.getCanvas();
  const w = canvas.width;
  const h = canvas.height;
  const dpr = window.devicePixelRatio || 1;

  /** Project [lng, lat] to canvas pixel [x, y] (accounting for devicePixelRatio) */
  const px = (coord: [number, number]): [number, number] => {
    const p = map.project(coord as [number, number]);
    return [p.x * dpr, p.y * dpr];
  };

  const svgParts: string[] = [];

  // SVG header — include xlink namespace for Illustrator compatibility
  svgParts.push(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);

  // Raster basemap layer
  svgParts.push('  <g id="basemap">');
  svgParts.push(`    <image xlink:href="${bgDataUrl}" href="${bgDataUrl}" width="${w}" height="${h}" />`);
  svgParts.push('  </g>');

  // --- Features group ---
  svgParts.push('  <g id="features">');

  // Shapes
  const shapes = shapeStore.getAll();
  for (const shape of shapes) {
    const dashArray = shape.strokeStyle === 'dashed' ? ' stroke-dasharray="8,4"'
      : shape.strokeStyle === 'dotted' ? ' stroke-dasharray="2,3"' : '';
    const sw = shape.strokeWidth * dpr;

    if (shape.type === 'rectangle' || shape.type === 'polygon') {
      const pts = shape.vertices.map((v) => px(v));
      const pointsStr = pts.map((p) => `${p[0]},${p[1]}`).join(' ');
      svgParts.push(`    <polygon points="${pointsStr}" fill="${shape.fill}" fill-opacity="${shape.fillOpacity}" stroke="${shape.stroke}" stroke-width="${sw}"${dashArray} />`);
    } else if (shape.type === 'ellipse') {
      const pts = shape.vertices.map((v) => px(v));
      // Center
      const ecx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const ecy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      // Semi-axes from edge midpoints
      const dx = Math.sqrt((pts[1][0] - pts[0][0]) ** 2 + (pts[1][1] - pts[0][1]) ** 2) / 2;
      const dy = Math.sqrt((pts[2][0] - pts[1][0]) ** 2 + (pts[2][1] - pts[1][1]) ** 2) / 2;
      const angle = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) * 180 / Math.PI;
      svgParts.push(`    <ellipse cx="${ecx}" cy="${ecy}" rx="${dx}" ry="${dy}" transform="rotate(${angle},${ecx},${ecy})" fill="${shape.fill}" fill-opacity="${shape.fillOpacity}" stroke="${shape.stroke}" stroke-width="${sw}"${dashArray} />`);
    } else if (shape.type === 'line') {
      const pts = shape.vertices.map((v) => px(v));
      if (pts.length >= 2) {
        svgParts.push(`    <line x1="${pts[0][0]}" y1="${pts[0][1]}" x2="${pts[1][0]}" y2="${pts[1][1]}" stroke="${shape.stroke}" stroke-width="${sw}"${dashArray} />`);
      }
    }
  }

  // Arrows
  const arrows = arrowStore.getAll();
  for (const arrow of arrows) {
    if (arrow.points.length < 2) continue;

    const dashArray = arrow.strokeStyle === 'dashed' ? ' stroke-dasharray="8,4"'
      : arrow.strokeStyle === 'dotted' ? ' stroke-dasharray="2,3"' : '';
    const sw = arrow.strokeWidth * dpr;

    // Sample spline and project
    const spline = arrow.points.length === 2 ? arrow.points : sampleSpline(arrow.points);
    const pxPts = spline.map((p) => px(p));

    // Shaft polyline
    const polyStr = pxPts.map((p) => `${p[0]},${p[1]}`).join(' ');
    svgParts.push(`    <polyline points="${polyStr}" fill="none" stroke="${arrow.stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"${dashArray} />`);

    // Arrowhead
    const end = px(arrow.points[arrow.points.length - 1]);
    const prev = pxPts[pxPts.length - 2] || pxPts[0];
    const adx = end[0] - prev[0];
    const ady = end[1] - prev[1];
    const mag = Math.sqrt(adx * adx + ady * ady);
    if (mag > 0) {
      const nx = adx / mag;
      const ny = ady / mag;
      const headLen = Math.max(sw * 4, 12 * dpr);
      const halfAngle = Math.PI / 7;
      const cosA = Math.cos(halfAngle);
      const sinA = Math.sin(halfAngle);
      const p1: [number, number] = [
        end[0] - headLen * (nx * cosA - ny * sinA),
        end[1] - headLen * (ny * cosA + nx * sinA),
      ];
      const p2: [number, number] = [
        end[0] - headLen * (nx * cosA + ny * sinA),
        end[1] - headLen * (ny * cosA - nx * sinA),
      ];
      svgParts.push(`    <polygon points="${p1[0]},${p1[1]} ${end[0]},${end[1]} ${p2[0]},${p2[1]}" fill="${arrow.stroke}" />`);
    }

    // Bidirectional: arrowhead at start
    if (arrow.bidirectional && pxPts.length >= 2) {
      const startPx = px(arrow.points[0]);
      const nextPx = pxPts[1] || pxPts[0];
      const sdx = startPx[0] - nextPx[0];
      const sdy = startPx[1] - nextPx[1];
      const smag = Math.sqrt(sdx * sdx + sdy * sdy);
      if (smag > 0) {
        const snx = sdx / smag;
        const sny = sdy / smag;
        const headLen = Math.max(sw * 4, 12 * dpr);
        const halfAngle = Math.PI / 7;
        const cosA = Math.cos(halfAngle);
        const sinA = Math.sin(halfAngle);
        const sp1: [number, number] = [
          startPx[0] - headLen * (snx * cosA - sny * sinA),
          startPx[1] - headLen * (sny * cosA + snx * sinA),
        ];
        const sp2: [number, number] = [
          startPx[0] - headLen * (snx * cosA + sny * sinA),
          startPx[1] - headLen * (sny * cosA - snx * sinA),
        ];
        svgParts.push(`    <polygon points="${sp1[0]},${sp1[1]} ${startPx[0]},${startPx[1]} ${sp2[0]},${sp2[1]}" fill="${arrow.stroke}" />`);
      }
    }
  }

  // Markers
  const markers = markerStore.getAll();
  for (const marker of markers) {
    const [mx, my] = px([marker.lng, marker.lat]);
    const r = 8 * marker.size * dpr;

    if (marker.shape === 'circle') {
      svgParts.push(`    <circle cx="${mx}" cy="${my}" r="${r}" fill="${marker.color}" />`);
    } else if (marker.shape === 'square') {
      svgParts.push(`    <rect x="${mx - r}" y="${my - r}" width="${r * 2}" height="${r * 2}" fill="${marker.color}" />`);
    } else if (marker.shape === 'triangle') {
      const pts = `${mx},${my - r} ${mx + r},${my + r} ${mx - r},${my + r}`;
      svgParts.push(`    <polygon points="${pts}" fill="${marker.color}" />`);
    } else if (marker.shape === 'pin') {
      const pr = r * 0.65;
      svgParts.push(`    <circle cx="${mx}" cy="${my - pr}" r="${pr}" fill="${marker.color}" />`);
      svgParts.push(`    <polygon points="${mx - pr * 0.6},${my - pr * 0.3} ${mx},${my + r} ${mx + pr * 0.6},${my - pr * 0.3}" fill="${marker.color}" />`);
    }
  }

  // Text annotations
  const annotations = annotationStore.getAll();
  for (const ann of annotations) {
    const [ax, ay] = px([ann.lng, ann.lat]);
    const fontSize = ann.fontSize * dpr;
    const fontFamily = ann.fontFamily === 'serif'
      ? "'Playfair Display', Georgia, serif"
      : "'Inter', Helvetica, Arial, sans-serif";
    const weight = ann.fontWeight === 'bold' ? 'bold' : 'normal';
    const fstyle = ann.fontStyle === 'italic' ? 'italic' : 'normal';
    const transform = ann.rotation ? ` transform="rotate(${ann.rotation},${ax},${ay})"` : '';

    if (ann.showBackground) {
      const estW = ann.text.length * fontSize * 0.55;
      const estH = fontSize * 1.3;
      svgParts.push(`    <rect x="${ax - 4 * dpr}" y="${ay - estH + 2 * dpr}" width="${estW + 8 * dpr}" height="${estH + 4 * dpr}" rx="2" fill="#ffffff" fill-opacity="0.85"${transform} />`);
    }

    svgParts.push(`    <text x="${ax}" y="${ay}" font-family="${fontFamily}" font-size="${fontSize}" font-weight="${weight}" font-style="${fstyle}" fill="${ann.color}"${transform}>${escapeXml(ann.text)}</text>`);
  }

  svgParts.push('  </g>');

  // --- Title overlay ---
  if (overlay.title || overlay.subtitle) {
    svgParts.push('  <g id="title-overlay">');
    const pad = 24 * dpr;
    const titleFontSize = overlay.titleSize * dpr;
    const subtitleFontSize = overlay.subtitleSize * dpr;
    const lineGap = 6 * dpr;

    // Estimate band height
    const titleH = overlay.title ? titleFontSize * 1.15 : 0;
    const subtitleH = overlay.subtitle ? subtitleFontSize * 1.3 : 0;
    const bandH = pad + titleH + (overlay.title && overlay.subtitle ? lineGap : 0) + subtitleH + pad;

    // Background band
    svgParts.push(`    <rect x="0" y="0" width="${w}" height="${bandH}" fill="#ffffff" fill-opacity="0.82" />`);
    svgParts.push(`    <line x1="0" y1="${bandH}" x2="${w}" y2="${bandH}" stroke="#000000" stroke-opacity="0.12" stroke-width="1" />`);

    const textAnchor = overlay.align === 'center' ? 'middle' : 'start';
    const textX = overlay.align === 'center' ? w / 2 : pad;

    let ty = pad;
    if (overlay.title) {
      ty += titleFontSize * 0.85; // baseline offset
      svgParts.push(`    <text x="${textX}" y="${ty}" font-family="'Playfair Display', Georgia, serif" font-size="${titleFontSize}" font-weight="700" fill="#1a1a1a" text-anchor="${textAnchor}">${escapeXml(overlay.title)}</text>`);
      ty += lineGap + titleFontSize * 0.3;
    }
    if (overlay.subtitle) {
      ty += subtitleFontSize * 0.85;
      svgParts.push(`    <text x="${textX}" y="${ty}" font-family="'Inter', Helvetica, Arial, sans-serif" font-size="${subtitleFontSize}" font-weight="400" fill="#666666" text-anchor="${textAnchor}">${escapeXml(overlay.subtitle)}</text>`);
    }
    svgParts.push('  </g>');
  }

  // --- Scale bar ---
  if (overlay.showScaleBar) {
    const center = map.getCenter();
    const sb = computeScaleBar(map.getZoom(), center.lat, overlay.scaleUnit, 150);
    const barW = sb.widthPx * dpr;
    const sPad = 16 * dpr;
    const barH = 6 * dpr;
    const sx = w - sPad - barW;
    const sy = h - sPad - barH - 20 * dpr; // nudge above attribution
    const labelSize = 11 * dpr;

    svgParts.push('  <g id="scale-bar">');
    // U-shape bar
    svgParts.push(`    <path d="M${sx},${sy + barH} L${sx},${sy} L${sx + barW},${sy} L${sx + barW},${sy + barH}" fill="none" stroke="#1a1a1a" stroke-width="${2 * dpr}" />`);
    // Label with white halo
    svgParts.push(`    <text x="${sx + barW}" y="${sy - 3 * dpr}" font-family="'Inter', Helvetica, Arial, sans-serif" font-size="${labelSize}" font-weight="600" fill="#1a1a1a" text-anchor="end" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${3 * dpr}" paint-order="stroke">${escapeXml(sb.label)}</text>`);
    svgParts.push('  </g>');
  }

  // --- Compass ---
  if (overlay.showCompass) {
    const bearing = map.getBearing();
    const compassSize = 40 * dpr;
    const cPad = 16 * dpr;
    const cx = w - cPad - compassSize / 2;
    const cy = cPad + compassSize / 2;
    const labelSize = 11 * dpr;

    svgParts.push(`  <g id="compass" transform="rotate(${-bearing}, ${cx}, ${cy})">`);
    // North pointer (dark)
    svgParts.push(`    <polygon points="${cx},${cy - compassSize * 0.4} ${cx + compassSize * 0.1},${cy - compassSize * 0.05} ${cx},${cy - compassSize * 0.1} ${cx - compassSize * 0.1},${cy - compassSize * 0.05}" fill="#1a1a1a" />`);
    // South pointer (light)
    svgParts.push(`    <polygon points="${cx},${cy + compassSize * 0.4} ${cx + compassSize * 0.1},${cy + compassSize * 0.05} ${cx},${cy + compassSize * 0.1} ${cx - compassSize * 0.1},${cy + compassSize * 0.05}" fill="#bbbbbb" />`);
    // Center dot
    svgParts.push(`    <circle cx="${cx}" cy="${cy}" r="${2 * dpr}" fill="#1a1a1a" />`);
    // N label
    svgParts.push(`    <text x="${cx}" y="${cy - compassSize * 0.4 - 3 * dpr}" font-family="'Playfair Display', Georgia, serif" font-size="${labelSize}" font-weight="700" fill="#1a1a1a" text-anchor="middle" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${3 * dpr}" paint-order="stroke">N</text>`);
    svgParts.push('  </g>');
  }

  // --- Legend ---
  if (legendEntries.length > 0) {
    const lPad = 12 * dpr;
    const rowH = 22 * dpr;
    const swatchSz = 14 * dpr;
    const lGap = 8 * dpr;
    const lFontSize = 12 * dpr;
    const lx0 = 12 * dpr;

    // Estimate max label width (rough: 7px per char at 12px)
    let maxLW = 0;
    for (const e of legendEntries) {
      const est = (e.label || '—').length * lFontSize * 0.55;
      if (est > maxLW) maxLW = est;
    }

    const boxW = lPad + swatchSz + lGap + maxLW + lPad;
    const boxH = lPad + legendEntries.length * rowH - (rowH - swatchSz) + lPad;
    const ly0 = h - 36 * dpr - boxH;

    svgParts.push('  <g id="legend">');
    svgParts.push(`    <rect x="${lx0}" y="${ly0}" width="${boxW}" height="${boxH}" rx="4" fill="#ffffff" fill-opacity="0.88" stroke="#000000" stroke-opacity="0.1" stroke-width="1" />`);

    for (let i = 0; i < legendEntries.length; i++) {
      const e = legendEntries[i];
      const ey = ly0 + lPad + i * rowH;
      const ecx = lx0 + lPad + swatchSz / 2;
      const ecy = ey + swatchSz / 2;
      const half = swatchSz / 2;
      const eStroke = e.strokeWidth > 0 ? e.strokeColor : 'none';
      const eSw = e.strokeWidth * dpr;

      if (e.symbol === 'circle') {
        svgParts.push(`    <circle cx="${ecx}" cy="${ecy}" r="${half}" fill="${e.color}" fill-opacity="${e.opacity}" stroke="${eStroke}" stroke-width="${eSw}" stroke-opacity="${e.strokeOpacity}" />`);
      } else if (e.symbol === 'square') {
        svgParts.push(`    <rect x="${lx0 + lPad}" y="${ey}" width="${swatchSz}" height="${swatchSz}" fill="${e.color}" fill-opacity="${e.opacity}" stroke="${eStroke}" stroke-width="${eSw}" stroke-opacity="${e.strokeOpacity}" />`);
      } else if (e.symbol === 'triangle') {
        svgParts.push(`    <polygon points="${ecx},${ey} ${lx0 + lPad + swatchSz},${ey + swatchSz} ${lx0 + lPad},${ey + swatchSz}" fill="${e.color}" fill-opacity="${e.opacity}" stroke="${eStroke}" stroke-width="${eSw}" stroke-opacity="${e.strokeOpacity}" />`);
      } else if (e.symbol === 'pin') {
        const pr = 4 * dpr;
        svgParts.push(`    <circle cx="${ecx}" cy="${ey + pr + dpr}" r="${pr}" fill="${e.color}" fill-opacity="${e.opacity}" stroke="${eStroke}" stroke-width="${eSw}" stroke-opacity="${e.strokeOpacity}" />`);
        svgParts.push(`    <polygon points="${ecx - pr},${ey + pr + dpr} ${ecx},${ey + swatchSz} ${ecx + pr},${ey + pr + dpr}" fill="${e.color}" fill-opacity="${e.opacity}" />`);
      } else if (e.symbol === 'line') {
        svgParts.push(`    <line x1="${lx0 + lPad}" y1="${ecy}" x2="${lx0 + lPad + swatchSz}" y2="${ecy}" stroke="${e.color}" stroke-width="${Math.max(eSw, 2 * dpr)}" stroke-opacity="${e.opacity}" stroke-linecap="round" />`);
      }

      // Label
      svgParts.push(`    <text x="${lx0 + lPad + swatchSz + lGap}" y="${ecy + lFontSize * 0.35}" font-family="'Inter', Helvetica, Arial, sans-serif" font-size="${lFontSize}" font-weight="500" fill="#1a1a1a">${escapeXml(e.label || '—')}</text>`);
    }
    svgParts.push('  </g>');
  }

  // Attribution
  {
    const aFontSize = 10 * dpr;
    const aPad = 6 * dpr;
    const estW = ATTRIBUTION.length * aFontSize * 0.5;
    const bgW = estW + aPad * 2;
    const bgH = aFontSize + aPad * 2;
    const ax = w - bgW - 4 * dpr;
    const ay = h - bgH - 4 * dpr;

    svgParts.push('  <g id="attribution">');
    svgParts.push(`    <rect x="${ax}" y="${ay}" width="${bgW}" height="${bgH}" rx="3" fill="#ffffff" fill-opacity="0.7" />`);
    svgParts.push(`    <text x="${ax + aPad}" y="${ay + aPad + aFontSize * 0.8}" font-family="'Inter', Helvetica, Arial, sans-serif" font-size="${aFontSize}" font-weight="400" fill="#555555">${escapeXml(ATTRIBUTION)}</text>`);
    svgParts.push('  </g>');
  }

  svgParts.push('</svg>');

  return svgParts.join('\n');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const ASPECT_PRESETS: { label: string; value: AspectRatio; icon: string }[] = [
  { label: 'Free', value: null, icon: '⊡' },
  { label: '3:2', value: '3:2', icon: '▬' },
  { label: '1:1', value: '1:1', icon: '■' },
  { label: '3:4', value: '3:4', icon: '▮' },
  { label: '9:16', value: '9:16', icon: '▯' },
];

export function ExportTools({ map, overlay, setOverlay, legendEntries, annotationStore, shapeStore, markerStore, arrowStore, aspectRatio, setAspectRatio }: ExportToolsProps) {
  const updateField = <K extends keyof OverlaySettings>(key: K, value: OverlaySettings[K]) => {
    setOverlay((prev) => ({ ...prev, [key]: value }));
  };

  const captureCanvas = (format: string, quality?: number): Promise<string> => {
    return new Promise((resolve) => {
      if (!map) { resolve(''); return; }
      map.triggerRepaint();
      map.once('idle', () => {
        const canvas = map.getCanvas();
        resolve(canvas.toDataURL(format, quality));
      });
    });
  };

  const exportJpg = async () => {
    if (!map) return;
    let dataUrl = await captureCanvas('image/png'); // capture as PNG first to preserve alpha
    // Composite onto white background (fixes black globe background in JPG)
    {
      const img = await loadImage(dataUrl);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d')!;
      cx.fillStyle = '#f0efeb'; // match sky color
      cx.fillRect(0, 0, c.width, c.height);
      cx.drawImage(img, 0, 0);
      dataUrl = c.toDataURL('image/jpeg', 0.92);
    }
    dataUrl = await compositeOverlay(dataUrl, overlay, 'image/jpeg', 0.92);
    if (overlay.showScaleBar) {
      dataUrl = await compositeScaleBar(dataUrl, map, overlay.scaleUnit, 'image/jpeg', 0.92);
    }
    if (overlay.showCompass) {
      const img = await loadImage(dataUrl);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(img, 0, 0);
      drawCompass(cx, c.width, map.getBearing());
      dataUrl = c.toDataURL('image/jpeg', 0.92);
    }
    if (legendEntries.length > 0) {
      const img = await loadImage(dataUrl);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(img, 0, 0);
      drawLegend(cx, c.width, c.height, legendEntries);
      dataUrl = c.toDataURL('image/jpeg', 0.92);
    }
    // Attribution
    {
      const img = await loadImage(dataUrl);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(img, 0, 0);
      drawAttribution(cx, c.width, c.height);
      dataUrl = c.toDataURL('image/jpeg', 0.92);
    }
    await downloadDataUrl(dataUrl, 'map-export.jpg');
  };

  const exportPng = async () => {
    if (!map) return;

    // 1. Capture background only (hide feature layers)
    const style = map.getStyle();
    const featureLayersHidden: string[] = [];

    for (const layer of style.layers || []) {
      const src = (layer as any).source as string | undefined;
      if (src && FEATURE_SOURCES.has(src)) {
        const vis = map.getLayoutProperty(layer.id, 'visibility');
        if (vis !== 'none') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
          featureLayersHidden.push(layer.id);
        }
      }
    }

    let bgDataUrl = await captureCanvas('image/png');
    // Add attribution to background
    {
      const bgImg = await loadImage(bgDataUrl);
      const c = document.createElement('canvas');
      c.width = bgImg.width; c.height = bgImg.height;
      const cx = c.getContext('2d')!;
      cx.drawImage(bgImg, 0, 0);
      drawAttribution(cx, c.width, c.height);
      bgDataUrl = c.toDataURL('image/png');
    }
    await downloadDataUrl(bgDataUrl, 'map-background.png');

    // Restore feature layers and wait for them to render
    for (const layerId of featureLayersHidden) {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    }
    await captureCanvas('image/png'); // wait for render (discard result)

    // 2. Hide basemap layers, capture features only on transparent background
    const hiddenLayers: string[] = [];

    // Hide all non-feature layers
    for (const layer of style.layers || []) {
      const src = (layer as any).source as string | undefined;
      if (!src || !FEATURE_SOURCES.has(src)) {
        const vis = map.getLayoutProperty(layer.id, 'visibility');
        if (vis !== 'none') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
          hiddenLayers.push(layer.id);
        }
      }
    }

    // Also hide selection/preview layers for a clean export
    for (const layerId of ['shapes-selection', 'arrows-selection', 'arrows-cp-lines', 'arrows-cp-handles']) {
      try {
        const vis = map.getLayoutProperty(layerId, 'visibility');
        if (vis !== 'none') {
          map.setLayoutProperty(layerId, 'visibility', 'none');
          hiddenLayers.push(layerId);
        }
      } catch { /* layer might not exist */ }
    }

    // Set background to transparent
    const oldBg = map.getPaintProperty('background', 'background-color');
    const oldBgOpacity = map.getPaintProperty('background', 'background-opacity');
    try {
      map.setPaintProperty('background', 'background-opacity', 0);
    } catch { /* no background layer */ }

    // Capture features only (no overlay on features layer)
    const featuresDataUrl = await captureCanvas('image/png');
    await downloadDataUrl(featuresDataUrl, 'map-features.png');

    // 3. Export overlay layers as standalone transparent PNGs
    const mapCanvas = map.getCanvas();
    const cw = mapCanvas.width;
    const ch = mapCanvas.height;

    if (overlay.title || overlay.subtitle) {
      const titleDataUrl = renderTitleOverlay(overlay, cw, ch);
      await downloadDataUrl(titleDataUrl, 'map-title.png');
    }

    if (overlay.showScaleBar) {
      const sbCanvas = document.createElement('canvas');
      sbCanvas.width = cw;
      sbCanvas.height = ch;
      const sbCtx = sbCanvas.getContext('2d')!;
      const center = map.getCenter();
      drawScaleBar(sbCtx, cw, ch, map.getZoom(), center.lat, overlay.scaleUnit);
      await downloadDataUrl(sbCanvas.toDataURL('image/png'), 'map-scalebar.png');
    }

    if (legendEntries.length > 0) {
      const lgCanvas = document.createElement('canvas');
      lgCanvas.width = cw;
      lgCanvas.height = ch;
      const lgCtx = lgCanvas.getContext('2d')!;
      drawLegend(lgCtx, cw, ch, legendEntries);
      await downloadDataUrl(lgCanvas.toDataURL('image/png'), 'map-legend.png');
    }

    // 4. Restore everything
    for (const layerId of hiddenLayers) {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    }
    try {
      if (oldBgOpacity !== undefined) {
        map.setPaintProperty('background', 'background-opacity', oldBgOpacity);
      } else {
        map.setPaintProperty('background', 'background-opacity', 1);
      }
      if (oldBg !== undefined) {
        map.setPaintProperty('background', 'background-color', oldBg);
      }
    } catch { /* no background layer */ }

    map.triggerRepaint();
  };

  const exportSvg = async () => {
    if (!map) return;

    // Capture basemap as raster PNG (hide features)
    const style = map.getStyle();
    const featureLayersHidden: string[] = [];

    for (const layer of style.layers || []) {
      const src = (layer as any).source as string | undefined;
      if (src && FEATURE_SOURCES.has(src)) {
        const vis = map.getLayoutProperty(layer.id, 'visibility');
        if (vis !== 'none') {
          map.setLayoutProperty(layer.id, 'visibility', 'none');
          featureLayersHidden.push(layer.id);
        }
      }
    }

    // Also hide selection/preview layers
    for (const layerId of ['shapes-selection', 'arrows-selection', 'arrows-cp-lines', 'arrows-cp-handles']) {
      try {
        const vis = map.getLayoutProperty(layerId, 'visibility');
        if (vis !== 'none') {
          map.setLayoutProperty(layerId, 'visibility', 'none');
          featureLayersHidden.push(layerId);
        }
      } catch { /* layer might not exist */ }
    }

    const bgDataUrl = await captureCanvas('image/png');

    // Restore feature layers
    for (const layerId of featureLayersHidden) {
      map.setLayoutProperty(layerId, 'visibility', 'visible');
    }
    map.triggerRepaint();

    // Build SVG — read features from stores (independent of map layer visibility)
    console.log('[SVG export] shapes:', shapeStore.getAll().length,
      'arrows:', arrowStore.getAll().length,
      'markers:', markerStore.getAll().length,
      'annotations:', annotationStore.getAll().length);

    const svgString = buildSvgExport(map, bgDataUrl, annotationStore, shapeStore, markerStore, arrowStore, overlay, legendEntries);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    await downloadDataUrl(url, 'map-export.svg');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportGeoJson = async () => {
    const features: GeoJSON.Feature[] = [];

    // Shapes
    for (const shape of shapeStore.getAll()) {
      const coords = shape.vertices.map((v) => [v[0], v[1]]);
      if (shape.type === 'rectangle' || shape.type === 'polygon' || shape.type === 'ellipse') {
        // Close the ring
        if (coords.length > 0) coords.push([...coords[0]]);
        features.push({
          type: 'Feature',
          properties: {
            type: shape.type,
            stroke: shape.stroke,
            strokeWidth: shape.strokeWidth,
            strokeStyle: shape.strokeStyle,
            fill: shape.fill,
            fillOpacity: shape.fillOpacity,
          },
          geometry: { type: 'Polygon', coordinates: [coords] },
        });
      } else if (shape.type === 'line') {
        features.push({
          type: 'Feature',
          properties: {
            type: 'line',
            stroke: shape.stroke,
            strokeWidth: shape.strokeWidth,
            strokeStyle: shape.strokeStyle,
          },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    }

    // Arrows
    for (const arrow of arrowStore.getAll()) {
      const sampled = arrow.points.length <= 2
        ? arrow.points
        : sampleSpline(arrow.points);
      const coords = sampled.map((p) => [p[0], p[1]]);
      features.push({
        type: 'Feature',
        properties: {
          type: 'arrow',
          stroke: arrow.stroke,
          strokeWidth: arrow.strokeWidth,
          strokeStyle: arrow.strokeStyle,
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }

    // Markers
    for (const marker of markerStore.getAll()) {
      features.push({
        type: 'Feature',
        properties: {
          type: 'marker',
          shape: marker.shape,
          color: marker.color,
          size: marker.size,
        },
        geometry: { type: 'Point', coordinates: [marker.lng, marker.lat] },
      });
    }

    // Annotations
    for (const ann of annotationStore.getAll()) {
      features.push({
        type: 'Feature',
        properties: {
          type: 'annotation',
          text: ann.text,
          fontSize: ann.fontSize,
          fontFamily: ann.fontFamily,
          fontWeight: ann.fontWeight,
          fontStyle: ann.fontStyle,
          color: ann.color,
          rotation: ann.rotation,
        },
        geometry: { type: 'Point', coordinates: [ann.lng, ann.lat] },
      });
    }

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    await downloadDataUrl(url, 'map-features.geojson');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="export-tools">
      {/* Aspect ratio presets */}
      <div className="style-row" style={{ marginBottom: 12 }}>
        <span className="style-label">Format</span>
        <div className="font-toggle">
          {ASPECT_PRESETS.map((preset) => (
            <button
              key={preset.label}
              className={`font-btn${aspectRatio === preset.value ? ' font-btn-on' : ''}`}
              onClick={() => setAspectRatio(preset.value)}
              title={preset.value ? `${preset.value} aspect ratio` : 'Free (fill available space)'}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="export-overlay-fields">
        <input
          type="text"
          className="export-title-input"
          placeholder="Map title"
          value={overlay.title}
          onChange={(e) => updateField('title', e.target.value)}
        />
        <input
          type="text"
          className="export-subtitle-input"
          placeholder="Subtitle / source line"
          value={overlay.subtitle}
          onChange={(e) => updateField('subtitle', e.target.value)}
        />
      </div>

      {/* Alignment */}
      <div className="style-row" style={{ marginBottom: 6 }}>
        <span className="style-label">Align</span>
        <div className="font-toggle">
          <button
            className={`font-btn${overlay.align === 'left' ? ' font-btn-on' : ''}`}
            onClick={() => updateField('align', 'left')}
            title="Left aligned"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 2h12M1 5.5h8M1 9h10M1 12.5h6" strokeLinecap="round"/>
            </svg>
          </button>
          <button
            className={`font-btn${overlay.align === 'center' ? ' font-btn-on' : ''}`}
            onClick={() => updateField('align', 'center')}
            title="Center aligned"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 2h12M3 5.5h8M2 9h10M4 12.5h6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Title size */}
      <div className="style-row">
        <span className="style-label">Title</span>
        <input
          type="range"
          className="style-slider"
          min={16}
          max={72}
          value={overlay.titleSize}
          onChange={(e) => updateField('titleSize', Number(e.target.value))}
        />
        <div className="style-value-input-wrap">
          <input
            type="number"
            className="style-value-input"
            min={16}
            max={72}
            value={overlay.titleSize}
            onChange={(e) => updateField('titleSize', Number(e.target.value))}
          />
          <span className="style-value-unit">px</span>
        </div>
      </div>

      {/* Subtitle size */}
      <div className="style-row">
        <span className="style-label">Sub</span>
        <input
          type="range"
          className="style-slider"
          min={10}
          max={48}
          value={overlay.subtitleSize}
          onChange={(e) => updateField('subtitleSize', Number(e.target.value))}
        />
        <div className="style-value-input-wrap">
          <input
            type="number"
            className="style-value-input"
            min={10}
            max={48}
            value={overlay.subtitleSize}
            onChange={(e) => updateField('subtitleSize', Number(e.target.value))}
          />
          <span className="style-value-unit">px</span>
        </div>
      </div>

      {/* Scale bar toggle + unit selector */}
      <div className="scale-bar-controls" style={{ marginTop: 18 }}>
        <label className="layer-toggle">
          <input
            type="checkbox"
            checked={overlay.showScaleBar}
            onChange={(e) => updateField('showScaleBar', e.target.checked)}
          />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-label">Scale bar</span>
        </label>
        {overlay.showScaleBar && (
          <div className="font-toggle" style={{ marginTop: 6, marginBottom: 2 }}>
            <button
              className={`font-btn${overlay.scaleUnit === 'metric' ? ' font-btn-on' : ''}`}
              onClick={() => updateField('scaleUnit', 'metric')}
            >
              km
            </button>
            <button
              className={`font-btn${overlay.scaleUnit === 'imperial' ? ' font-btn-on' : ''}`}
              onClick={() => updateField('scaleUnit', 'imperial')}
            >
              mi
            </button>
            <button
              className={`font-btn${overlay.scaleUnit === 'nautical' ? ' font-btn-on' : ''}`}
              onClick={() => updateField('scaleUnit', 'nautical')}
            >
              nmi
            </button>
            <span style={{ display: 'inline-block', width: 1, height: 14, background: '#d1d1d1', alignSelf: 'center' }} />
          </div>
        )}
      </div>

      {/* Compass toggle */}
      <div style={{ marginTop: 6 }}>
        <label className="layer-toggle">
          <input
            type="checkbox"
            checked={overlay.showCompass}
            onChange={(e) => updateField('showCompass', e.target.checked)}
          />
          <span className="toggle-track">
            <span className="toggle-thumb" />
          </span>
          <span className="toggle-label">Compass</span>
        </label>
      </div>

      <div className="export-btn-row" style={{ marginTop: 18 }}>
        <button className="action-btn" onClick={exportJpg} disabled={!map}>
          Export JPG
        </button>
        <button className="action-btn" onClick={exportPng} disabled={!map}>
          Export PNG ({2 + (overlay.title || overlay.subtitle ? 1 : 0) + (overlay.showScaleBar ? 1 : 0) + (legendEntries.length > 0 ? 1 : 0)} files)
        </button>
      </div>

      <div className="export-experimental-label">Experimental</div>
      <div className="export-btn-row" style={{ marginTop: 6 }}>
        <button
          className="action-btn"
          onClick={exportSvg}
          disabled={!map}
          title="Basemap is embedded as raster (large file). Features are vector but text background boxes may not render, fonts may show warnings in Illustrator, and marker sizes may differ."
        >
          Export SVG
        </button>
        <button
          className="action-btn"
          onClick={exportGeoJson}
          disabled={!map}
          title="Exports shapes, markers, and arrows as GeoJSON. Text annotations, arrowheads, colors, and fill styles are stored as properties but won't render in most GeoJSON viewers."
        >
          Export GeoJSON
        </button>
      </div>
    </div>
  );
}
