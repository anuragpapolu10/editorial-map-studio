import { useEffect, useRef, useState } from 'react';
import maplibregl, { addProtocol, removeProtocol } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { layers } from '@protomaps/basemaps';
import { EDITORIAL_FLAVOR } from '../editorial-style';
import { createMarkerIcons } from '../markers';
import { computeScaleBar } from '../scalebar';
import type { ScaleBarInfo } from '../scalebar';

import type { OverlaySettings } from '../App';
import type { LegendEntry } from '../legend';
import type { HeatmapLegendInfo } from '../dataStore';

const HEATMAP_GRADIENTS: Record<string, string> = {
  inferno: 'linear-gradient(to right, rgba(243,120,25,0.3), #fca50a, #f6d746, #fcffa4)',
  magma: 'linear-gradient(to right, rgba(183,55,121,0.3), #de4968, #fe9f6d, #fcfdbf)',
  plasma: 'linear-gradient(to right, rgba(125,3,168,0.3), #cb4679, #f89441, #f0f921)',
  viridis: 'linear-gradient(to right, rgba(33,145,140,0.3), #35b779, #b5de2b, #fde725)',
};

interface MapViewProps {
  onMapReady?: (map: maplibregl.Map) => void;
  overlay?: OverlaySettings | null;
  legendEntries?: LegendEntry[];
  heatmapLegend?: HeatmapLegendInfo | null;
}

class GlobeControl implements maplibregl.IControl {
  private container: HTMLDivElement | null = null;
  private map: maplibregl.Map | null = null;
  private button: HTMLButtonElement | null = null;
  private isGlobe = false;

  onAdd(map: maplibregl.Map) {
    this.map = map;
    this.container = document.createElement('div');
    this.container.className = 'maplibregl-ctrl maplibregl-ctrl-group';

    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.title = 'Toggle globe view';
    this.updateIcon();
    this.button.style.cssText = 'display:flex;align-items:center;justify-content:center;cursor:pointer;';

    this.button.addEventListener('click', () => {
      if (!this.map) return;
      this.isGlobe = !this.isGlobe;

      if (this.isGlobe) {
        this.map.setProjection({ type: 'globe' });
        this.map.easeTo({ pitch: 45, duration: 600 });
      } else {
        this.map.setProjection({ type: 'mercator' });
        this.map.easeTo({ pitch: 0, duration: 600 });
      }
      this.updateIcon();
    });

    this.container.appendChild(this.button);
    return this.container;
  }

  private updateIcon() {
    if (!this.button) return;
    if (this.isGlobe) {
      // Globe icon (active)
      this.button.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="#333" stroke-width="1.5">
        <circle cx="10" cy="10" r="8"/>
        <ellipse cx="10" cy="10" rx="3.5" ry="8"/>
        <path d="M2.5 7.5h15M2.5 12.5h15" stroke-linecap="round"/>
      </svg>`;
    } else {
      // Flat map icon (inactive)
      this.button.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="#888" stroke-width="1.5">
        <circle cx="10" cy="10" r="8"/>
        <ellipse cx="10" cy="10" rx="3.5" ry="8"/>
        <path d="M2.5 7.5h15M2.5 12.5h15" stroke-linecap="round"/>
      </svg>`;
    }
  }

  onRemove() {
    this.container?.remove();
    this.map = null;
  }
}

/** Map the (fontWeight, fontStyle) pair to a MapLibre font stack name */
function getFontStack(_family: string, weight: string, style: string): string {
  if (weight === 'bold' && style === 'italic') return 'Noto Sans Bold Italic';
  if (weight === 'bold') return 'Noto Sans Bold';
  if (style === 'italic') return 'Noto Sans Italic';
  return 'Noto Sans Regular';
}

/** All 4 font combos we need layers for (sans only) */
const FONT_COMBOS = [
  { family: 'sans', weight: 'normal', style: 'normal' },
  { family: 'sans', weight: 'bold',   style: 'normal' },
  { family: 'sans', weight: 'normal', style: 'italic' },
  { family: 'sans', weight: 'bold',   style: 'italic' },
];

export const ANNOTATION_LAYER_IDS = FONT_COMBOS.map(
  (c) => `ann-${c.family}-${c.weight}-${c.style}`
);

export const MARKER_LAYER_ID = 'markers-symbol';

export const SHAPE_LAYER_IDS = [
  'shapes-fill',
  'shapes-stroke-solid',
  'shapes-stroke-dashed',
  'shapes-stroke-dotted',
];

export const ARROW_SHAFT_LAYER_IDS = [
  'arrows-shaft-solid',
  'arrows-shaft-dashed',
  'arrows-shaft-dotted',
  'arrows-head',
];

export const ARROW_CP_HANDLE_LAYER_ID = 'arrows-cp-handles';
export const SHAPE_HANDLE_LAYER_ID = 'shape-handles';

export function MapView({ onMapReady, overlay, legendEntries = [], heatmapLegend }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [coords, setCoords] = useState({ lng: 0, lat: 0 });
  const [scaleBar, setScaleBar] = useState<ScaleBarInfo | null>(null);
  const [bearing, setBearing] = useState(0);

  // Re-compute scale bar and bearing when map moves
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const update = () => {
      const center = m.getCenter();
      setScaleBar(computeScaleBar(m.getZoom(), center.lat, overlay?.scaleUnit));
      setBearing(m.getBearing());
    };
    update();
    m.on('moveend', update);
    m.on('zoomend', update);
    m.on('rotate', update);
    return () => {
      m.off('moveend', update);
      m.off('zoomend', update);
      m.off('rotate', update);
    };
  }, [overlay?.scaleUnit, overlay?.showScaleBar, overlay?.showCompass]);

  // Toggle minimap visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector('#inset-minimap') as HTMLElement;
    if (el) {
      el.style.display = overlay?.showMinimap === false ? 'none' : '';
    }
  }, [overlay?.showMinimap]);

  // Sync minimap zoom offset from sidebar slider
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const offset = overlay?.minimapZoomOffset ?? -5;
    (map as any)._minimapZoomOffset = offset;
    const minimapMap = (map as any)._minimapMap as maplibregl.Map | undefined;
    if (minimapMap) {
      minimapMap.setCenter(map.getCenter());
      minimapMap.setZoom(Math.max(map.getZoom() + offset, 0));
    }
  }, [overlay?.minimapZoomOffset]);

  // Sync minimap size from sidebar slider
  useEffect(() => {
    const container = containerRef.current;
    const map = mapRef.current;
    if (!container || !map) return;
    const el = container.querySelector('#inset-minimap') as HTMLElement;
    if (!el) return;
    const size = overlay?.minimapSize ?? 180;
    const height = Math.round(size * 130 / 180);
    el.style.width = `${size}px`;
    el.style.height = `${height}px`;
    const minimapMap = (map as any)._minimapMap as maplibregl.Map | undefined;
    if (minimapMap) minimapMap.resize();
  }, [overlay?.minimapSize]);

  // Toggle minimap labels
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const minimapMap = (map as any)._minimapMap as maplibregl.Map | undefined;
    if (!minimapMap) return;

    const showLabels = overlay?.minimapShowLabels !== false;
    const showCountries = showLabels && overlay?.minimapShowCountries !== false;
    const showStates = showLabels && overlay?.minimapShowStates !== false;
    const showCities = showLabels && overlay?.minimapShowCities !== false;

    const groups: Record<string, boolean> = {
      'places_country': showCountries,
      'places_region': showStates,
      'places_locality': showCities,
      'places_subplace': showCities,
      'address_label': showLabels,
      'water_waterway_label': showLabels,
      'roads_oneway': showLabels,
      'roads_labels_minor': showLabels,
      'water_label_ocean': showLabels,
      'earth_label_islands': showLabels,
      'water_label_lakes': showLabels,
      'roads_shields': showLabels,
      'roads_labels_major': showLabels,
    };

    for (const [id, show] of Object.entries(groups)) {
      if (minimapMap.getLayer(id)) {
        minimapMap.setLayoutProperty(id, 'visibility', show ? 'visible' : 'none');
      }
    }
  }, [overlay?.minimapShowLabels, overlay?.minimapShowCountries, overlay?.minimapShowStates, overlay?.minimapShowCities]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const protocol = new Protocol();
    addProtocol('pmtiles', protocol.tile);

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {
          protomaps: {
            type: 'vector',
            tiles: ['https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=0a52651ea40e292b'],
            maxzoom: 15,
            attribution: '<a href="https://editorialmapstudio.com">Editorial Map Studio</a> | <a href="https://protomaps.com">Protomaps</a> | <a href="https://openstreetmap.org">OSM</a>',
          },
          terrain: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            encoding: 'terrarium',
            tileSize: 256,
            maxzoom: 15,
          },
          satellite: {
            type: 'raster',
            tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
            tileSize: 256,
            maxzoom: 19,
            attribution: 'Esri, Maxar, Earthstar Geographics',
          },
        },
        layers: [
          ...layers('protomaps', EDITORIAL_FLAVOR, { lang: 'en' }).slice(0, 2),
          {
            id: 'satellite',
            type: 'raster' as const,
            source: 'satellite',
            paint: {
              'raster-opacity': 0,
              'raster-saturation': -0.3,
            },
          },
          {
            id: 'hillshade',
            type: 'hillshade' as const,
            source: 'terrain',
            paint: {
              'hillshade-exaggeration': 0.7,
              'hillshade-shadow-color': '#7a7468',
              'hillshade-highlight-color': '#ffffff',
              'hillshade-accent-color': '#5e5850',
              'hillshade-illumination-direction': 315,
            },
          },
          ...layers('protomaps', EDITORIAL_FLAVOR, { lang: 'en' }).slice(2),
        ],
      },
      center: [-73.95, 40.65],
      zoom: 10,
      attributionControl: { compact: false },
      preserveDrawingBuffer: true as any, // needed for canvas.toDataURL() export
    } as any);

    const navCtrl = new maplibregl.NavigationControl({ visualizePitch: true });
    map.addControl(navCtrl, 'top-right');
    map.addControl(new GlobeControl(), 'top-right');

    // Inset minimap — a second maplibre instance synced to the main map
    const minimapDiv = document.createElement('div');
    minimapDiv.id = 'inset-minimap';
    containerRef.current.appendChild(minimapDiv);

    const minimapMap = new maplibregl.Map({
      container: minimapDiv,
      style: {
        version: 8,
        glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
        sources: {
          protomaps: {
            type: 'vector',
            tiles: ['https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=0a52651ea40e292b'],
            maxzoom: 15,
          },
        },
        layers: layers('protomaps', EDITORIAL_FLAVOR, { lang: 'en' }),
      },
      center: map.getCenter(),
      zoom: Math.max(map.getZoom() + (overlay?.minimapZoomOffset ?? -5), 0),
      interactive: false,
      attributionControl: false,
      preserveDrawingBuffer: true,
    } as any);

    (map as any)._minimapZoomOffset = overlay?.minimapZoomOffset ?? -5;

    // Sync minimap to main map movement
    const syncMinimap = () => {
      const offset = (map as any)._minimapZoomOffset ?? -5;
      minimapMap.setCenter(map.getCenter());
      minimapMap.setZoom(Math.max(map.getZoom() + offset, 0));
    };
    map.on('move', syncMinimap);

    // Draw viewport indicator on minimap
    minimapMap.on('load', () => {
      minimapMap.addSource('viewport-box', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      minimapMap.addLayer({
        id: 'viewport-box-fill',
        type: 'fill',
        source: 'viewport-box',
        paint: {
          'fill-color': '#4a90d9',
          'fill-opacity': 0.12,
        },
      });
      minimapMap.addLayer({
        id: 'viewport-box-stroke',
        type: 'line',
        source: 'viewport-box',
        paint: {
          'line-color': '#4a90d9',
          'line-width': 1.5,
        },
      });

      const updateBox = () => {
        const bounds = map.getBounds();
        const sw = bounds.getSouthWest();
        const ne = bounds.getNorthEast();
        const ring = [
          [sw.lng, sw.lat],
          [ne.lng, sw.lat],
          [ne.lng, ne.lat],
          [sw.lng, ne.lat],
          [sw.lng, sw.lat],
        ];
        (minimapMap.getSource('viewport-box') as maplibregl.GeoJSONSource).setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
      };
      updateBox();
      map.on('move', updateBox);
    });

    (map as any)._minimapMap = minimapMap;

    // Add helpful tooltips and custom compass icon
    setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const compass = container.querySelector('.maplibregl-ctrl-compass') as HTMLElement;
      if (compass) {
        compass.title = 'Drag to rotate & tilt the map. Click to reset north.';
        // Replace default compass with needle + rotation ring
        const span = compass.querySelector('.maplibregl-ctrl-icon') as HTMLElement;
        if (span) {
          span.style.backgroundImage = 'none';
          span.innerHTML = `<svg viewBox="0 0 28 28" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Rotation ring with arrows -->
            <path d="M14 3.5a10.5 10.5 0 0 1 9.1 5.25" stroke="#333" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M24.5 14a10.5 10.5 0 0 1-5.25 9.1" stroke="#333" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M14 24.5a10.5 10.5 0 0 1-9.1-5.25" stroke="#333" stroke-width="1.3" stroke-linecap="round"/>
            <path d="M3.5 14a10.5 10.5 0 0 1 5.25-9.1" stroke="#333" stroke-width="1.3" stroke-linecap="round"/>
            <polygon points="22.8,8.2 24.2,8.0 23.1,9.2" fill="#333"/>
            <polygon points="19.8,22.8 20.0,24.2 18.8,23.1" fill="#333"/>
            <polygon points="5.2,19.8 3.8,20.0 4.9,18.8" fill="#333"/>
            <polygon points="8.2,5.2 8.0,3.8 9.2,4.9" fill="#333"/>
            <!-- Compass needle (monochrome) -->
            <polygon points="14,7 17,12.5 11,12.5" fill="#333"/>
            <polygon points="14,21 17,15.5 11,15.5" fill="#bbb"/>
          </svg>`;
        }
      }
      const zoomIn = container.querySelector('.maplibregl-ctrl-zoom-in') as HTMLElement;
      if (zoomIn) zoomIn.title = 'Zoom in';
      const zoomOut = container.querySelector('.maplibregl-ctrl-zoom-out') as HTMLElement;
      if (zoomOut) zoomOut.title = 'Zoom out';
    }, 100);

    map.on('mousemove', (e) => {
      setCoords({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    map.on('load', () => {
      map.setTerrain({ source: 'terrain', exaggeration: 1.5 });
      (map as any).setSky({
        'sky-color': '#f0efeb',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#e8e5de',
        'horizon-fog-blend': 0.5,
        'fog-color': '#f0efeb',
        'fog-ground-blend': 0.5,
      });

      // --- Shape layers ---
      if (!map.getSource('shapes')) {
        map.addSource('shapes', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Fill for closed shapes (rectangle, ellipse, polygon)
        map.addLayer({
          id: 'shapes-fill',
          type: 'fill',
          source: 'shapes',
          filter: ['!=', ['get', 'shapeType'], 'line'],
          paint: {
            'fill-color': ['get', 'fill'],
            'fill-opacity': ['get', 'fillOpacity'],
          },
        });

        // Stroke layers — one per dash style (line-dasharray is not data-driven)
        map.addLayer({
          id: 'shapes-stroke-solid',
          type: 'line',
          source: 'shapes',
          filter: ['any', ['!', ['has', 'strokeStyle']], ['==', ['get', 'strokeStyle'], 'solid']],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
          },
        });

        map.addLayer({
          id: 'shapes-stroke-dashed',
          type: 'line',
          source: 'shapes',
          filter: ['==', ['get', 'strokeStyle'], 'dashed'],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
            'line-dasharray': [4, 3],
          },
          layout: {
            'line-cap': 'butt',
          },
        });

        map.addLayer({
          id: 'shapes-stroke-dotted',
          type: 'line',
          source: 'shapes',
          filter: ['==', ['get', 'strokeStyle'], 'dotted'],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
            'line-dasharray': [1, 2.5],
          },
          layout: {
            'line-cap': 'round',
          },
        });

        // Direction arrow icon (SDF chevron for line-placed symbols)
        if (!map.hasImage('direction-arrow')) {
          const sz = 16;
          const canvas = document.createElement('canvas');
          canvas.width = sz;
          canvas.height = sz;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.moveTo(4, 2);
          ctx.lineTo(13, 8);
          ctx.lineTo(4, 14);
          ctx.lineTo(6, 8);
          ctx.closePath();
          ctx.fill();
          const imgData = ctx.getImageData(0, 0, sz, sz);
          map.addImage('direction-arrow', imgData, { sdf: true });
        }

        // Direction arrows along lines/polygons
        map.addLayer({
          id: 'shapes-direction-arrows',
          type: 'symbol',
          source: 'shapes',
          filter: ['==', ['get', 'showDirectionArrows'], true],
          layout: {
            'symbol-placement': 'line',
            'symbol-spacing': 80,
            'icon-image': 'direction-arrow',
            'icon-size': ['interpolate', ['linear'], ['get', 'strokeWidth'], 1, 0.8, 4, 1.4, 8, 2.2, 12, 3],
            'icon-allow-overlap': true,
            'icon-rotation-alignment': 'map',
          },
          paint: {
            'icon-color': ['get', 'stroke'],
            'icon-opacity': 0.8,
          },
        });

        // Selection outline (dashed blue)
        map.addLayer({
          id: 'shapes-selection',
          type: 'line',
          source: 'shapes',
          filter: ['==', ['get', 'selected'], true],
          paint: {
            'line-color': '#4a90d9',
            'line-width': 2,
            'line-dasharray': [5, 3],
          },
        });
      }

      // --- Shape preview (in-progress drawing) ---
      if (!map.getSource('shapes-preview')) {
        map.addSource('shapes-preview', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'shapes-preview-fill',
          type: 'fill',
          source: 'shapes-preview',
          paint: {
            'fill-color': '#4a90d9',
            'fill-opacity': 0.08,
          },
        });

        map.addLayer({
          id: 'shapes-preview-stroke',
          type: 'line',
          source: 'shapes-preview',
          paint: {
            'line-color': '#4a90d9',
            'line-width': 2,
            'line-dasharray': [6, 3],
          },
        });
      }

      // --- Annotation layers ---
      if (!map.getSource('annotations')) {
        // Create a 1×1 white pixel image for text background boxes
        const bgSize = 1;
        const bgData = new Uint8Array(bgSize * bgSize * 4);
        bgData.set([255, 255, 255, 255]);
        map.addImage('text-bg', { width: bgSize, height: bgSize, data: bgData });

        map.addSource('annotations', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Selection highlight — a circle behind the selected label
        map.addLayer({
          id: 'ann-selection-highlight',
          type: 'circle',
          source: 'annotations',
          filter: ['==', ['get', 'selected'], true],
          paint: {
            'circle-radius': ['*', ['get', 'fontSize'], 0.9],
            'circle-color': '#4a90d9',
            'circle-opacity': 0.12,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#4a90d9',
            'circle-stroke-opacity': 0.6,
          },
        });

        // One symbol layer per font combo
        for (const combo of FONT_COMBOS) {
          const layerId = `ann-${combo.family}-${combo.weight}-${combo.style}`;
          const fontStack = getFontStack(combo.family, combo.weight, combo.style);

          map.addLayer({
            id: layerId,
            type: 'symbol',
            source: 'annotations',
            filter: [
              'all',
              ['==', ['get', 'fontFamily'], combo.family],
              ['==', ['get', 'fontWeight'], combo.weight],
              ['==', ['get', 'fontStyle'], combo.style],
            ],
            layout: {
              'text-field': ['get', 'text'],
              'text-size': ['get', 'fontSize'],
              'text-font': [fontStack],
              'text-anchor': 'center',
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'text-rotate': ['get', 'rotation'],
              'icon-image': 'text-bg',
              'icon-text-fit': 'both',
              'icon-text-fit-padding': [4, 8, 4, 8],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-rotate': ['get', 'rotation'],
            },
            paint: {
              'text-color': ['get', 'color'],
              'text-halo-color': ['case',
                ['==', ['get', 'textStroke'], 'black'], '#000000',
                '#ffffff',
              ],
              'text-halo-width': ['case',
                ['==', ['get', 'textStroke'], 'none'], 0,
                1.5,
              ],
              'icon-opacity': ['case', ['get', 'showBackground'], 0.8, 0],
            },
          });
        }
      }

      // --- Marker layers ---
      if (!map.getSource('markers')) {
        // Register SDF marker icons
        const icons = createMarkerIcons();
        for (const [name, { data, sdf }] of Object.entries(icons)) {
          if (!map.hasImage(name)) {
            map.addImage(name, data, { sdf });
          }
        }

        map.addSource('markers', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Selection ring behind selected marker
        map.addLayer({
          id: 'markers-selection',
          type: 'circle',
          source: 'markers',
          filter: ['==', ['get', 'selected'], true],
          paint: {
            'circle-radius': ['*', ['get', 'size'], 18],
            'circle-color': '#4a90d9',
            'circle-opacity': 0.12,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#4a90d9',
            'circle-stroke-opacity': 0.6,
          },
        });

        // Main marker symbol layer
        map.addLayer({
          id: 'markers-symbol',
          type: 'symbol',
          source: 'markers',
          layout: {
            'icon-image': ['get', 'markerShape'],
            'icon-size': ['get', 'size'],
            'icon-allow-overlap': true,
            'icon-ignore-placement': true,
            'icon-anchor': 'bottom',
          },
          paint: {
            'icon-color': ['get', 'color'],
            'icon-halo-color': '#ffffff',
            'icon-halo-width': 1.5,
          },
        });
      }

      // --- Arrow layers ---
      if (!map.getSource('arrows')) {
        map.addSource('arrows', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        // Shaft layers (one per dash style, since line-dasharray is not data-driven)
        map.addLayer({
          id: 'arrows-shaft-solid',
          type: 'line',
          source: 'arrows',
          filter: ['all',
            ['==', ['get', 'featureType'], 'shaft'],
            ['any', ['!', ['has', 'strokeStyle']], ['==', ['get', 'strokeStyle'], 'solid']],
          ],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        map.addLayer({
          id: 'arrows-shaft-dashed',
          type: 'line',
          source: 'arrows',
          filter: ['all',
            ['==', ['get', 'featureType'], 'shaft'],
            ['==', ['get', 'strokeStyle'], 'dashed'],
          ],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
            'line-dasharray': [4, 3],
          },
          layout: { 'line-cap': 'butt' },
        });

        map.addLayer({
          id: 'arrows-shaft-dotted',
          type: 'line',
          source: 'arrows',
          filter: ['all',
            ['==', ['get', 'featureType'], 'shaft'],
            ['==', ['get', 'strokeStyle'], 'dotted'],
          ],
          paint: {
            'line-color': ['get', 'stroke'],
            'line-width': ['get', 'strokeWidth'],
            'line-dasharray': [1, 2.5],
          },
          layout: { 'line-cap': 'round' },
        });

        // Arrowhead fill (solid triangle)
        map.addLayer({
          id: 'arrows-head',
          type: 'fill',
          source: 'arrows',
          filter: ['==', ['get', 'featureType'], 'head'],
          paint: {
            'fill-color': ['get', 'stroke'],
            'fill-opacity': 1,
          },
        });

        // Selection highlight (wider semi-transparent glow behind shaft)
        map.addLayer({
          id: 'arrows-selection',
          type: 'line',
          source: 'arrows',
          filter: ['all',
            ['==', ['get', 'selected'], true],
            ['==', ['get', 'featureType'], 'shaft'],
          ],
          paint: {
            'line-color': '#4a90d9',
            'line-width': ['case', ['has', 'strokeWidth'], ['+', ['get', 'strokeWidth'], 6], 8],
            'line-opacity': 0.25,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });

        // Control point guide lines
        map.addLayer({
          id: 'arrows-cp-lines',
          type: 'line',
          source: 'arrows',
          filter: ['==', ['get', 'featureType'], 'cp-line'],
          paint: {
            'line-color': '#4a90d9',
            'line-width': 1,
            'line-dasharray': [4, 3],
          },
        });

        // Control point handles
        map.addLayer({
          id: 'arrows-cp-handles',
          type: 'circle',
          source: 'arrows',
          filter: ['==', ['get', 'featureType'], 'cp'],
          paint: {
            'circle-radius': 6,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#4a90d9',
          },
        });
      }

      // --- Shape handles (resize/vertex drag) ---
      if (!map.getSource('shape-handles')) {
        map.addSource('shape-handles', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'shape-handles',
          type: 'circle',
          source: 'shape-handles',
          paint: {
            'circle-radius': 5,
            'circle-color': '#ffffff',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#4a90d9',
          },
        });
      }

      // --- Arrow preview ---
      if (!map.getSource('arrows-preview')) {
        map.addSource('arrows-preview', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        });

        map.addLayer({
          id: 'arrows-preview-shaft',
          type: 'line',
          source: 'arrows-preview',
          filter: ['==', ['get', 'featureType'], 'shaft'],
          paint: {
            'line-color': '#4a90d9',
            'line-width': 2,
            'line-dasharray': [6, 3],
          },
          layout: { 'line-cap': 'round' },
        });

        map.addLayer({
          id: 'arrows-preview-head',
          type: 'fill',
          source: 'arrows-preview',
          filter: ['==', ['get', 'featureType'], 'head'],
          paint: {
            'fill-color': '#4a90d9',
            'fill-opacity': 0.5,
          },
        });
      }

      onMapReady?.(map);
    });

    mapRef.current = map;
    (window as any).__map = map;

    return () => {
      minimapMap.remove();
      minimapDiv.remove();
      map.remove();
      removeProtocol('pmtiles');
      mapRef.current = null;
    };
  }, []);

  const showTitle = overlay && (overlay.title || overlay.subtitle);

  return (
    <div className="map-container">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showTitle && (
        <div
          className="title-overlay-preview"
          style={{ textAlign: overlay.align }}
        >
          {overlay.title && (
            <div
              className="title-overlay-title"
              style={{ fontSize: overlay.titleSize }}
            >
              {overlay.title}
            </div>
          )}
          {overlay.subtitle && (
            <div
              className="title-overlay-subtitle"
              style={{ fontSize: overlay.subtitleSize }}
            >
              {overlay.subtitle}
            </div>
          )}
        </div>
      )}
      {overlay?.showScaleBar && scaleBar && (
        <div className="scale-bar-preview">
          <div className="scale-bar-line" style={{ width: scaleBar.widthPx }} />
          <div className="scale-bar-label">{scaleBar.label}</div>
        </div>
      )}
      {overlay?.showCompass && (
        <div className="compass-preview" style={{ transform: `rotate(${-bearing}deg)` }}>
          <div className="compass-label">N</div>
          <svg viewBox="0 0 40 40" width="40" height="40">
            <polygon points="20,4 24,18 20,16 16,18" fill="#1a1a1a" />
            <polygon points="20,36 24,22 20,24 16,22" fill="#bbb" />
            <circle cx="20" cy="20" r="2" fill="#1a1a1a" />
          </svg>
        </div>
      )}
      {(legendEntries.length > 0 || heatmapLegend?.visible) && (
        <div className="legend-preview">
          {legendEntries.map((entry) => (
            <div key={entry.id} className="legend-preview-row">
              <svg width="16" height="16" className="legend-preview-swatch">
                {entry.symbol === 'circle' && (
                  <circle cx="8" cy="8" r="6"
                    fill={entry.color} fillOpacity={entry.opacity}
                    stroke={entry.strokeWidth > 0 ? entry.strokeColor : 'none'}
                    strokeWidth={entry.strokeWidth} strokeOpacity={entry.strokeOpacity}
                  />
                )}
                {entry.symbol === 'square' && (
                  <rect x="2" y="2" width="12" height="12"
                    fill={entry.color} fillOpacity={entry.opacity}
                    stroke={entry.strokeWidth > 0 ? entry.strokeColor : 'none'}
                    strokeWidth={entry.strokeWidth} strokeOpacity={entry.strokeOpacity}
                  />
                )}
                {entry.symbol === 'triangle' && (
                  <polygon points="8,2 14,14 2,14"
                    fill={entry.color} fillOpacity={entry.opacity}
                    stroke={entry.strokeWidth > 0 ? entry.strokeColor : 'none'}
                    strokeWidth={entry.strokeWidth} strokeOpacity={entry.strokeOpacity}
                  />
                )}
                {entry.symbol === 'pin' && (
                  <g>
                    <circle cx="8" cy="5.5" r="4"
                      fill={entry.color} fillOpacity={entry.opacity}
                      stroke={entry.strokeWidth > 0 ? entry.strokeColor : 'none'}
                      strokeWidth={entry.strokeWidth} strokeOpacity={entry.strokeOpacity}
                    />
                    <polygon points="5.5,8 8,15 10.5,8"
                      fill={entry.color} fillOpacity={entry.opacity}
                      stroke={entry.strokeWidth > 0 ? entry.strokeColor : 'none'}
                      strokeWidth={entry.strokeWidth} strokeOpacity={entry.strokeOpacity}
                    />
                  </g>
                )}
                {entry.symbol === 'line' && (
                  <line x1="1" y1="8" x2="15" y2="8"
                    stroke={entry.color} strokeWidth={Math.max(entry.strokeWidth, 2)}
                    opacity={entry.opacity} strokeLinecap="round"
                  />
                )}
              </svg>
              <span className="legend-preview-label">{entry.label || '—'}</span>
            </div>
          ))}
          {heatmapLegend?.visible && (
            <div className="legend-heatmap">
              <span className="legend-heatmap-title">{heatmapLegend.title}</span>
              <div
                className="legend-heatmap-bar"
                style={{ background: HEATMAP_GRADIENTS[heatmapLegend.ramp] }}
              />
              <div className="legend-heatmap-range">
                <span>{heatmapLegend.min}</span>
                <span>{heatmapLegend.max}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="coords-display">
        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
      </div>
    </div>
  );
}
