import { useState, useEffect, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { DataState, DataRow, HeatmapLegendInfo } from '../dataStore';
import {
  DEFAULT_DATA_STATE,
  parseCSV, autoDetectColumns, extractPoints, getSkippedRows,
  getValueRange, pointsToGeoJSON, getSampleCSV, geocodeLocations,
} from '../dataStore';
import { ColorPickerPopover } from './ColorPickerPopover';

const SOURCE_ID = 'data-points-source';
const LAYER_ID = 'data-points-layer';
const LABEL_LAYER_ID = 'data-labels-layer';
const VALUE_LAYER_ID = 'data-values-layer';
const HEATMAP_LAYER_ID = 'data-heatmap-layer';
const SPIKE_SOURCE_ID = 'data-spikes-source';
const SPIKE_LAYER_ID = 'data-spikes-layer';
const SPIKE_OUTLINE_LAYER_ID = 'data-spikes-outline-layer';
const SPIKE_LABELS_SOURCE_ID = 'data-spike-labels-source';
const SPIKE_LABELS_LAYER_ID = 'data-spike-labels-layer';
const SPIKE_BASE_LABELS_SOURCE_ID = 'data-spike-base-labels-source';
const SPIKE_BASE_LABELS_LAYER_ID = 'data-spike-base-labels-layer';

const HEATMAP_RAMPS: Record<string, maplibregl.ExpressionSpecification> = {
  inferno: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.1, 'rgba(243,120,25,0.1)',
    0.2, 'rgba(243,120,25,0.25)',
    0.35, 'rgba(252,165,10,0.45)',
    0.5, 'rgba(252,165,10,0.65)',
    0.65, 'rgba(246,215,70,0.8)',
    0.8, '#f6d746',
    1,   '#fcffa4',
  ],
  magma: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.1, 'rgba(183,55,121,0.1)',
    0.2, 'rgba(222,73,104,0.25)',
    0.35, 'rgba(247,112,92,0.45)',
    0.5, 'rgba(254,159,109,0.65)',
    0.65, 'rgba(254,207,146,0.8)',
    0.8, '#fecf92',
    1,   '#fcfdbf',
  ],
  plasma: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.1, 'rgba(125,3,168,0.1)',
    0.2, 'rgba(168,34,150,0.25)',
    0.35, 'rgba(203,70,121,0.45)',
    0.5, 'rgba(229,107,93,0.65)',
    0.65, 'rgba(248,148,65,0.8)',
    0.8, '#fdc328',
    1,   '#f0f921',
  ],
  viridis: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.1, 'rgba(33,145,140,0.1)',
    0.2, 'rgba(31,158,137,0.25)',
    0.35, 'rgba(53,183,121,0.45)',
    0.5, 'rgba(110,206,88,0.65)',
    0.65, 'rgba(181,222,43,0.8)',
    0.8, '#b5de2b',
    1,   '#fde725',
  ],
};

const DATA_COLORS = [
  '#e63946', '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261',
  '#264653', '#6a4c93', '#1d3557', '#a8dadc', '#ff6b6b',
];

interface DataToolsProps {
  map: maplibregl.Map | null;
  onHeatmapLegend?: (info: HeatmapLegendInfo | null) => void;
}

export function DataTools({ map, onHeatmapLegend }: DataToolsProps) {
  const [data, setData] = useState<DataState>(DEFAULT_DATA_STATE);
  const [pasteText, setPasteText] = useState('');
  const sourceAdded = useRef(false);
  const [geocoding, setGeocoding] = useState<{ active: boolean; done: number; total: number }>({ active: false, done: 0, total: 0 });
  const [regionBias, setRegionBias] = useState('');
  const [geocodeCol, setGeocodeCol] = useState('');
  const [geocodeContextCol, setGeocodeContextCol] = useState('');

  const update = useCallback((patch: Partial<DataState>) => {
    setData(prev => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    if (!onHeatmapLegend) return;
    if (data.vizType !== 'heatmap' || !data.valueCol || data.rows.length === 0) {
      onHeatmapLegend(null);
      return;
    }
    const points = extractPoints(data);
    const { min, max } = getValueRange(points);
    onHeatmapLegend({
      visible: true,
      title: data.heatmapLegendTitle || data.valueCol,
      ramp: data.heatmapColorRamp,
      min,
      max,
    });
  }, [data.vizType, data.valueCol, data.rows, data.heatmapColorRamp, data.heatmapLegendTitle, onHeatmapLegend]);

  const handleGeocode = useCallback(async (locationCol: string, rows: DataRow[], columns: string[], bias: string, contextCol?: string) => {
    setGeocoding({ active: true, done: 0, total: 0 });
    const results = await geocodeLocations(rows, locationCol, (done, total) => {
      setGeocoding({ active: true, done, total });
    }, bias.trim(), contextCol);

    const latCol = '_geocoded_lat';
    const lngCol = '_geocoded_lng';
    const newRows = rows.map((row, i) => ({
      ...row,
      [latCol]: results[i].lat !== null ? String(results[i].lat) : '',
      [lngCol]: results[i].lng !== null ? String(results[i].lng) : '',
    }));
    const newColumns = columns.includes(latCol) ? columns : [...columns, latCol, lngCol];

    setData(prev => ({
      ...prev,
      rows: newRows,
      columns: newColumns,
      latCol,
      lngCol,
    }));
    setGeocoding({ active: false, done: 0, total: 0 });
  }, []);

  const loadCSV = useCallback((text: string) => {
    const { rows, columns } = parseCSV(text);
    if (rows.length === 0) return;
    const detected = autoDetectColumns(columns);
    setData(prev => ({
      ...prev,
      raw: text,
      rows,
      columns,
      ...detected,
    }));
    setPasteText(text);
    setGeocodeCol(columns[0] || '');
    setGeocodeContextCol('');
  }, []);

  const handlePaste = () => {
    const text = pasteText.trim();
    if (!text) return;
    loadCSV(text);
  };

  const handleSample = () => {
    const csv = getSampleCSV();
    setPasteText(csv);
    loadCSV(csv);
  };

  const handleClear = () => {
    if (data.rows.length > 0 && !confirm('Clear all data and remove points from the map?')) return;
    setData(DEFAULT_DATA_STATE);
    setPasteText('');
  };

  // Sync points to map
  useEffect(() => {
    if (!map) return;

    const points = extractPoints(data);
    const geojson = pointsToGeoJSON(points, data.labelAnchors, data.formatCommas, data.valuePrefix, data.valueSuffix);

    if (!sourceAdded.current) {
      if (map.getSource(SOURCE_ID)) {
        (map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource).setData(geojson);
      } else {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojson });
        sourceAdded.current = true;
      }
    } else {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(geojson);
    }

    // Circle layer: add if needed, toggle visibility based on vizType
    if (data.vizType !== 'heatmap' && data.vizType !== 'spikes') {
      if (!map.getLayer(LAYER_ID) && sourceAdded.current) {
        map.addLayer({
          id: LAYER_ID,
          type: 'circle',
          source: SOURCE_ID,
          paint: {
            'circle-radius': data.pointRadius,
            'circle-color': data.pointColor,
            'circle-opacity': data.opacity,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff',
            'circle-stroke-opacity': data.opacity,
          },
        });
      }
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', 'visible');
      }
    } else {
      if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', 'none');
      }
    }

    // Heatmap layer: add if needed, toggle visibility
    if (data.vizType === 'heatmap') {
      const points = extractPoints(data);
      const { min, max } = getValueRange(points);
      const weightExpr: maplibregl.ExpressionSpecification | undefined = data.valueCol
        ? ['interpolate', ['linear'], ['coalesce', ['get', 'value'], min], min, 0, max, 1]
        : undefined;

      if (!map.getLayer(HEATMAP_LAYER_ID) && sourceAdded.current) {
        map.addLayer({
          id: HEATMAP_LAYER_ID,
          type: 'heatmap',
          source: SOURCE_ID,
          paint: {
            'heatmap-radius': data.heatmapRadius,
            'heatmap-intensity': data.heatmapIntensity,
            'heatmap-opacity': data.opacity,
            'heatmap-color': HEATMAP_RAMPS[data.heatmapColorRamp],
            ...(weightExpr ? { 'heatmap-weight': weightExpr } : {}),
          },
        });
      }
      if (map.getLayer(HEATMAP_LAYER_ID)) {
        map.setLayoutProperty(HEATMAP_LAYER_ID, 'visibility', 'visible');
      }
    } else {
      if (map.getLayer(HEATMAP_LAYER_ID)) {
        map.setLayoutProperty(HEATMAP_LAYER_ID, 'visibility', 'none');
      }
    }

    return () => {};
  }, [map, data.rows, data.latCol, data.lngCol, data.valueCol, data.vizType, data.pointColor, data.pointRadius, data.maxRadius, data.opacity, data.labelAnchors, data.formatCommas, data.valuePrefix, data.valueSuffix, data.heatmapRadius, data.heatmapIntensity, data.heatmapColorRamp]);

  // Update paint properties when style changes
  useEffect(() => {
    if (!map || !map.getLayer(LAYER_ID)) return;

    const points = extractPoints(data);
    const { min, max } = getValueRange(points);

    if (data.vizType === 'bubbles' && data.valueCol) {
      map.setPaintProperty(LAYER_ID, 'circle-radius', [
        'interpolate', ['linear'],
        ['coalesce', ['get', 'value'], min],
        min, data.pointRadius,
        max, data.maxRadius,
      ]);
    } else {
      map.setPaintProperty(LAYER_ID, 'circle-radius', data.pointRadius);
    }

    map.setPaintProperty(LAYER_ID, 'circle-color', data.pointColor);
    map.setPaintProperty(LAYER_ID, 'circle-opacity', data.opacity);
    map.setPaintProperty(LAYER_ID, 'circle-stroke-opacity', data.opacity);
  }, [map, data.vizType, data.pointColor, data.pointRadius, data.maxRadius, data.opacity, data.valueCol, data.rows]);

  // Update heatmap paint properties
  useEffect(() => {
    if (!map || !map.getLayer(HEATMAP_LAYER_ID) || data.vizType !== 'heatmap') return;

    map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-radius', data.heatmapRadius);
    map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-intensity', data.heatmapIntensity);
    map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-opacity', data.opacity);
    map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-color', HEATMAP_RAMPS[data.heatmapColorRamp]);

    if (data.valueCol) {
      const points = extractPoints(data);
      const { min, max } = getValueRange(points);
      map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-weight',
        ['interpolate', ['linear'], ['coalesce', ['get', 'value'], min], min, 0, max, 1]
      );
    } else {
      map.setPaintProperty(HEATMAP_LAYER_ID, 'heatmap-weight', 1);
    }
  }, [map, data.vizType, data.heatmapRadius, data.heatmapIntensity, data.opacity, data.heatmapColorRamp, data.valueCol, data.rows]);

  // Manage spike layer
  const spikeDataRef = useRef(data);
  spikeDataRef.current = data;

  useEffect(() => {
    if (!map) return;
    if (data.vizType !== 'spikes' || !data.valueCol || data.rows.length === 0) {
      if (map.getLayer(SPIKE_LAYER_ID)) map.setLayoutProperty(SPIKE_LAYER_ID, 'visibility', 'none');
      if (map.getLayer(SPIKE_OUTLINE_LAYER_ID)) map.setLayoutProperty(SPIKE_OUTLINE_LAYER_ID, 'visibility', 'none');
      if (map.getLayer(SPIKE_LABELS_LAYER_ID)) map.setLayoutProperty(SPIKE_LABELS_LAYER_ID, 'visibility', 'none');
      if (map.getLayer(SPIKE_BASE_LABELS_LAYER_ID)) map.setLayoutProperty(SPIKE_BASE_LABELS_LAYER_ID, 'visibility', 'none');
      return;
    }

    const buildSpikeGeoJSON = (): { polys: GeoJSON.FeatureCollection; labels: GeoJSON.FeatureCollection; baseLabels: GeoJSON.FeatureCollection } => {
      const d = spikeDataRef.current;
      const pts = extractPoints(d);
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      if (pts.length === 0 || !d.valueCol) return { polys: empty, labels: empty, baseLabels: empty };
      const { min, max } = getValueRange(pts);
      const range = max - min || 1;
      const halfW = d.spikeWidth / 2;

      const polyFeatures: GeoJSON.Feature[] = [];
      const labelFeatures: GeoJSON.Feature[] = [];
      const baseLabelFeatures: GeoJSON.Feature[] = [];
      for (const p of pts) {
        const val = p.value ?? min;
        const t = (val - min) / range;
        const h = d.spikeHeight * t;
        if (h < 1) continue;

        const base = map.project([p.lng, p.lat]);
        let coords: [number, number][];
        let tipLng: number;
        let tipLat: number;

        if (d.spikeStyle === 'pointed') {
          const tip = map.unproject([base.x, base.y - h]);
          const left = map.unproject([base.x - halfW, base.y]);
          const right = map.unproject([base.x + halfW, base.y]);
          tipLng = tip.lng; tipLat = tip.lat;
          coords = [
            [left.lng, left.lat],
            [tip.lng, tip.lat],
            [right.lng, right.lat],
            [left.lng, left.lat],
          ];
        } else {
          const tl = map.unproject([base.x - halfW, base.y - h]);
          const tr = map.unproject([base.x + halfW, base.y - h]);
          const br = map.unproject([base.x + halfW, base.y]);
          const bl = map.unproject([base.x - halfW, base.y]);
          const topCenter = map.unproject([base.x, base.y - h]);
          tipLng = topCenter.lng; tipLat = topCenter.lat;
          coords = [
            [bl.lng, bl.lat],
            [tl.lng, tl.lat],
            [tr.lng, tr.lat],
            [br.lng, br.lat],
            [bl.lng, bl.lat],
          ];
        }

        polyFeatures.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [coords] },
          properties: { value: p.value, label: p.label },
        });

        let fv = '';
        if (p.value !== null) {
          fv = (d.spikeCommas ? p.value.toLocaleString('en-US') : String(p.value)) + d.spikeSuffix;
        }
        labelFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [tipLng, tipLat] },
          properties: { formattedValue: fv },
        });

        baseLabelFeatures.push({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
          properties: { label: p.label },
        });
      }
      return {
        polys: { type: 'FeatureCollection', features: polyFeatures },
        labels: { type: 'FeatureCollection', features: labelFeatures },
        baseLabels: { type: 'FeatureCollection', features: baseLabelFeatures },
      };
    };

    const { polys, labels, baseLabels } = buildSpikeGeoJSON();

    if (!map.getSource(SPIKE_SOURCE_ID)) {
      map.addSource(SPIKE_SOURCE_ID, { type: 'geojson', data: polys });
    } else {
      (map.getSource(SPIKE_SOURCE_ID) as maplibregl.GeoJSONSource).setData(polys);
    }

    if (!map.getSource(SPIKE_LABELS_SOURCE_ID)) {
      map.addSource(SPIKE_LABELS_SOURCE_ID, { type: 'geojson', data: labels });
    } else {
      (map.getSource(SPIKE_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource).setData(labels);
    }

    if (!map.getSource(SPIKE_BASE_LABELS_SOURCE_ID)) {
      map.addSource(SPIKE_BASE_LABELS_SOURCE_ID, { type: 'geojson', data: baseLabels });
    } else {
      (map.getSource(SPIKE_BASE_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource).setData(baseLabels);
    }

    if (!map.getLayer(SPIKE_LAYER_ID)) {
      map.addLayer({
        id: SPIKE_LAYER_ID,
        type: 'fill',
        source: SPIKE_SOURCE_ID,
        paint: {
          'fill-color': data.spikeColor,
          'fill-opacity': data.opacity * 0.35,
        },
      });
    }
    if (!map.getLayer(SPIKE_OUTLINE_LAYER_ID)) {
      map.addLayer({
        id: SPIKE_OUTLINE_LAYER_ID,
        type: 'line',
        source: SPIKE_SOURCE_ID,
        paint: {
          'line-color': data.spikeColor,
          'line-width': 1,
          'line-opacity': data.opacity,
        },
      });
    }

    if (data.spikeShowValues) {
      if (!map.getLayer(SPIKE_LABELS_LAYER_ID)) {
        map.addLayer({
          id: SPIKE_LABELS_LAYER_ID,
          type: 'symbol',
          source: SPIKE_LABELS_SOURCE_ID,
          layout: {
            'text-field': ['get', 'formattedValue'],
            'text-size': data.spikeLabelSize,
            'text-anchor': 'bottom',
            'text-offset': [0, -0.3],
            'text-allow-overlap': true,
            'icon-allow-overlap': true,
          },
          paint: {
            'text-color': '#333',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });
      }
      map.setLayoutProperty(SPIKE_LABELS_LAYER_ID, 'text-size', data.spikeLabelSize);
      map.setLayoutProperty(SPIKE_LABELS_LAYER_ID, 'visibility', 'visible');
    } else {
      if (map.getLayer(SPIKE_LABELS_LAYER_ID)) {
        map.setLayoutProperty(SPIKE_LABELS_LAYER_ID, 'visibility', 'none');
      }
    }

    if (data.spikeShowLabels && data.labelCol) {
      if (!map.getLayer(SPIKE_BASE_LABELS_LAYER_ID)) {
        map.addLayer({
          id: SPIKE_BASE_LABELS_LAYER_ID,
          type: 'symbol',
          source: SPIKE_BASE_LABELS_SOURCE_ID,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': data.spikeLabelSize,
            'text-anchor': 'top',
            'text-offset': [0, 0.4],
            'text-allow-overlap': true,
            'icon-allow-overlap': true,
          },
          paint: {
            'text-color': '#333',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });
      }
      map.setLayoutProperty(SPIKE_BASE_LABELS_LAYER_ID, 'text-size', data.spikeLabelSize);
      map.setLayoutProperty(SPIKE_BASE_LABELS_LAYER_ID, 'visibility', 'visible');
    } else {
      if (map.getLayer(SPIKE_BASE_LABELS_LAYER_ID)) {
        map.setLayoutProperty(SPIKE_BASE_LABELS_LAYER_ID, 'visibility', 'none');
      }
    }

    map.setPaintProperty(SPIKE_LAYER_ID, 'fill-color', data.spikeColor);
    map.setPaintProperty(SPIKE_LAYER_ID, 'fill-opacity', data.opacity * 0.35);
    map.setPaintProperty(SPIKE_OUTLINE_LAYER_ID, 'line-color', data.spikeColor);
    map.setPaintProperty(SPIKE_OUTLINE_LAYER_ID, 'line-opacity', data.opacity);
    map.setLayoutProperty(SPIKE_LAYER_ID, 'visibility', 'visible');
    map.setLayoutProperty(SPIKE_OUTLINE_LAYER_ID, 'visibility', 'visible');

    const onMoveEnd = () => {
      const result = buildSpikeGeoJSON();
      const src = map.getSource(SPIKE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (src) src.setData(result.polys);
      const labelSrc = map.getSource(SPIKE_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (labelSrc) labelSrc.setData(result.labels);
      const baseSrc = map.getSource(SPIKE_BASE_LABELS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (baseSrc) baseSrc.setData(result.baseLabels);
    };
    map.on('moveend', onMoveEnd);
    return () => {
      map.off('moveend', onMoveEnd);
    };
  }, [map, data.vizType, data.valueCol, data.rows, data.spikeStyle, data.spikeHeight, data.spikeWidth, data.spikeColor, data.opacity, data.spikeShowValues, data.spikeCommas, data.spikeSuffix, data.spikeShowLabels, data.labelCol, data.spikeLabelSize]);

  // Manage label layer (below point) and value layer (above point)
  useEffect(() => {
    if (!map || !sourceAdded.current) return;

    const isPointOrBubble = data.vizType === 'points' || data.vizType === 'bubbles';
    const wantLabels = isPointOrBubble && data.showLabels && data.labelCol;
    const wantValues = isPointOrBubble && data.showValues && data.valueCol;

    const points = extractPoints(data);
    const { min, max } = getValueRange(points);

    let labelOffset: maplibregl.ExpressionSpecification | number;
    let valueOffset: maplibregl.ExpressionSpecification | number;

    if (data.vizType === 'bubbles' && data.valueCol) {
      const radiusExpr: maplibregl.ExpressionSpecification = [
        'interpolate', ['linear'],
        ['coalesce', ['get', 'value'], min],
        min, data.pointRadius,
        max, data.maxRadius,
      ];
      const baseOffset = ['+', ['/', radiusExpr, data.labelSize], 0.4] as maplibregl.ExpressionSpecification;
      labelOffset = baseOffset;
      valueOffset = baseOffset;
    } else {
      labelOffset = 0.8;
      valueOffset = 0.8;
    }

    // Label layer — below the point
    if (wantLabels) {
      if (!map.getLayer(LABEL_LAYER_ID)) {
        map.addLayer({
          id: LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'text-field': ['get', 'label'],
            'text-size': data.labelSize,
            'text-anchor': 'top',
            'text-radial-offset': labelOffset,
            'text-allow-overlap': true,
            'icon-allow-overlap': true,
          },
          paint: {
            'text-color': '#333',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });
      } else {
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-field', ['get', 'label']);
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-size', data.labelSize);
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-anchor', 'top');
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-radial-offset', labelOffset);
      }
    } else {
      if (map.getLayer(LABEL_LAYER_ID)) {
        map.removeLayer(LABEL_LAYER_ID);
      }
    }

    // Value layer — above the point
    if (wantValues) {
      if (!map.getLayer(VALUE_LAYER_ID)) {
        map.addLayer({
          id: VALUE_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'text-field': ['get', 'formattedValue'],
            'text-size': data.labelSize,
            'text-anchor': 'bottom',
            'text-radial-offset': valueOffset,
            'text-allow-overlap': true,
            'icon-allow-overlap': true,
          },
          paint: {
            'text-color': '#333',
            'text-halo-color': '#fff',
            'text-halo-width': 1.5,
          },
        });
      } else {
        map.setLayoutProperty(VALUE_LAYER_ID, 'text-field', ['get', 'formattedValue']);
        map.setLayoutProperty(VALUE_LAYER_ID, 'text-size', data.labelSize);
        map.setLayoutProperty(VALUE_LAYER_ID, 'text-anchor', 'bottom');
        map.setLayoutProperty(VALUE_LAYER_ID, 'text-radial-offset', valueOffset);
      }
    } else {
      if (map.getLayer(VALUE_LAYER_ID)) {
        map.removeLayer(VALUE_LAYER_ID);
      }
    }
  }, [map, data.showLabels, data.showValues, data.labelCol, data.valueCol, data.labelSize, data.rows, data.formatCommas, data.valuePrefix, data.valueSuffix, data.vizType, data.pointRadius, data.maxRadius]);

  // Zoom to data after loading
  const zoomedRef = useRef<string>('');
  useEffect(() => {
    if (!map || data.rows.length === 0) return;
    const key = data.raw.slice(0, 100) + data.rows.length + (data.latCol ?? '') + (data.lngCol ?? '');
    if (zoomedRef.current === key) return;
    zoomedRef.current = key;

    const points = extractPoints(data);
    if (points.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    points.forEach(p => bounds.extend([p.lng, p.lat]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 12 });
  }, [map, data.rows, data.latCol, data.lngCol, data.raw]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (map) {
        if (map.getLayer(VALUE_LAYER_ID)) map.removeLayer(VALUE_LAYER_ID);
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
        if (map.getLayer(SPIKE_BASE_LABELS_LAYER_ID)) map.removeLayer(SPIKE_BASE_LABELS_LAYER_ID);
        if (map.getLayer(SPIKE_LABELS_LAYER_ID)) map.removeLayer(SPIKE_LABELS_LAYER_ID);
        if (map.getLayer(SPIKE_OUTLINE_LAYER_ID)) map.removeLayer(SPIKE_OUTLINE_LAYER_ID);
        if (map.getLayer(SPIKE_LAYER_ID)) map.removeLayer(SPIKE_LAYER_ID);
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
        if (map.getSource(SPIKE_BASE_LABELS_SOURCE_ID)) map.removeSource(SPIKE_BASE_LABELS_SOURCE_ID);
        if (map.getSource(SPIKE_LABELS_SOURCE_ID)) map.removeSource(SPIKE_LABELS_SOURCE_ID);
        if (map.getSource(SPIKE_SOURCE_ID)) map.removeSource(SPIKE_SOURCE_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
        sourceAdded.current = false;
      }
    };
  }, [map]);

  const points = extractPoints(data);
  const skippedRows = getSkippedRows(data);
  const hasData = data.rows.length > 0;
  const hasCoords = !!data.latCol && !!data.lngCol;

  return (
    <div className="data-tools">
      {/* Step 1: Paste data */}
      <textarea
        className="data-paste-area"
        placeholder="Paste your data here (CSV or tab-separated)..."
        value={pasteText}
        onChange={e => setPasteText(e.target.value)}
        rows={hasData ? 3 : 5}
      />

      <div className="data-btn-row">
        <button className="data-btn data-btn-primary" onClick={handlePaste} disabled={!pasteText.trim()}>
          Load data
        </button>
        {!hasData ? (
          <button className="data-btn" onClick={handleSample}>
            Try sample data
          </button>
        ) : (
          <button className="data-btn" onClick={handleClear}>
            Clear data
          </button>
        )}
      </div>

      {/* Row count feedback */}
      {hasData && (
        <div className="data-row-count">
          <p style={{ margin: 0 }}>
            {points.length} point{points.length !== 1 ? 's' : ''} loaded
            {skippedRows.length > 0 && <>, {skippedRows.length} skipped</>}
          </p>
          {skippedRows.length > 0 && (
            <div className="data-skipped-list">
              {skippedRows.map((s, i) => (
                <div key={i} className="data-skipped-item">
                  <span className="data-skipped-name">{s.name}</span>
                  <span className="data-skipped-reason">{s.reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Geocode prompt */}
      {hasData && !hasCoords && !geocoding.active && data.columns.length > 0 && (
        <div className="data-geocode-prompt">
          <p>No coordinates found. Geocode locations?</p>
          <div className="data-col-row">
            <span className="data-col-label">Geocode by</span>
            <select
              className="data-col-select"
              value={geocodeCol}
              onChange={e => setGeocodeCol(e.target.value)}
            >
              {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          {data.columns.length > 1 && (
            <div className="data-col-row">
              <span className="data-col-label">Context</span>
              <select
                className="data-col-select"
                value={geocodeContextCol}
                onChange={e => setGeocodeContextCol(e.target.value)}
              >
                <option value="">None</option>
                {data.columns.filter(c => c !== geocodeCol).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          <input
            className="data-region-input"
            type="text"
            placeholder="Narrow search, e.g. UK, Brazil..."
            value={regionBias}
            onChange={e => setRegionBias(e.target.value)}
          />
          <div className="data-btn-row">
            <button
              className="data-btn data-btn-primary"
              onClick={() => handleGeocode(geocodeCol, data.rows, data.columns, regionBias, geocodeContextCol || undefined)}
            >
              Geocode
            </button>
          </div>
        </div>
      )}

      {/* Geocoding progress */}
      {geocoding.active && (
        <div className="data-geocode-progress">
          <p>Geocoding... {geocoding.done} of {geocoding.total} locations</p>
          <div className="data-progress-bar">
            <div
              className="data-progress-fill"
              style={{ width: geocoding.total ? `${(geocoding.done / geocoding.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      )}

      {/* Step 2: Column pickers — revealed after data loads */}
      {hasData && (
        <div className="data-columns">
          <div className="data-columns-header">Columns</div>

          <div className="data-col-row">
            <span className="data-col-label">Latitude</span>
            <select
              className="data-col-select"
              value={data.latCol ?? ''}
              onChange={e => update({ latCol: e.target.value || null })}
            >
              <option value="">Pick column…</option>
              {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="data-col-row">
            <span className="data-col-label">Longitude</span>
            <select
              className="data-col-select"
              value={data.lngCol ?? ''}
              onChange={e => update({ lngCol: e.target.value || null })}
            >
              <option value="">Pick column…</option>
              {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="data-col-row">
            <span className="data-col-label">Value</span>
            <select
              className="data-col-select"
              value={data.valueCol ?? ''}
              onChange={e => update({ valueCol: e.target.value || null })}
            >
              <option value="">None</option>
              {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="data-col-row">
            <span className="data-col-label">Label</span>
            <select
              className="data-col-select"
              value={data.labelCol ?? ''}
              onChange={e => update({ labelCol: e.target.value || null })}
            >
              <option value="">None</option>
              {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* Step 3: Viz options — revealed after coordinates are set */}
      {hasData && hasCoords && (
        <div className="data-viz-options">
          <div className="data-columns-header">Visualization</div>

          <div className="data-viz-types">
            <button
              className={`data-viz-type-btn ${data.vizType === 'points' ? 'active' : ''}`}
              onClick={() => update({ vizType: 'points' })}
            >
              Points
            </button>
            <button
              className={`data-viz-type-btn ${data.vizType === 'bubbles' ? 'active' : ''}`}
              onClick={() => update({ vizType: 'bubbles' })}
              disabled={!data.valueCol}
              title={!data.valueCol ? 'Pick a value column first' : ''}
            >
              Bubbles
            </button>
            <button
              className={`data-viz-type-btn ${data.vizType === 'spikes' ? 'active' : ''}`}
              onClick={() => update({ vizType: 'spikes' })}
              disabled={!data.valueCol}
              title={!data.valueCol ? 'Pick a value column first' : ''}
            >
              Spikes
            </button>
            <button
              className={`data-viz-type-btn ${data.vizType === 'heatmap' ? 'active' : ''}`}
              onClick={() => update({ vizType: 'heatmap' })}
            >
              Heatmap
            </button>
          </div>

          {/* Style controls */}
          <div className="data-style-section">
            {data.vizType === 'spikes' ? (
              <>
                <div className="style-row">
                  <span className="style-label">Style</span>
                  <div className="data-viz-types" style={{ gap: 0 }}>
                    <button
                      className={`data-viz-type-btn ${data.spikeStyle === 'pointed' ? 'active' : ''}`}
                      onClick={() => update({ spikeStyle: 'pointed' })}
                    >
                      Spike
                    </button>
                    <button
                      className={`data-viz-type-btn ${data.spikeStyle === 'bar' ? 'active' : ''}`}
                      onClick={() => update({ spikeStyle: 'bar' })}
                    >
                      Bar
                    </button>
                  </div>
                </div>

                <div className="style-row">
                  <span className="style-label">Color</span>
                  <ColorPickerPopover color={data.spikeColor} onChange={c => update({ spikeColor: c })} presetColors={DATA_COLORS} />
                </div>

                <div className="style-row">
                  <span className="style-label">Height</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={30}
                    max={300}
                    value={data.spikeHeight}
                    onChange={e => update({ spikeHeight: Number(e.target.value) })}
                  />
                  <span className="style-value">{data.spikeHeight}px</span>
                </div>

                <div className="style-row">
                  <span className="style-label">Width</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={2}
                    max={20}
                    value={data.spikeWidth}
                    onChange={e => update({ spikeWidth: Number(e.target.value) })}
                  />
                  <span className="style-value">{data.spikeWidth}px</span>
                </div>

                <div className="style-row">
                  <span className="style-label">Values</span>
                  <button
                    className={`data-toggle-btn ${data.spikeShowValues ? 'active' : ''}`}
                    onClick={() => update({ spikeShowValues: !data.spikeShowValues })}
                  >
                    {data.spikeShowValues ? 'On' : 'Off'}
                  </button>
                </div>
                {data.labelCol && (
                  <div className="style-row">
                    <span className="style-label">Labels</span>
                    <button
                      className={`data-toggle-btn ${data.spikeShowLabels ? 'active' : ''}`}
                      onClick={() => update({ spikeShowLabels: !data.spikeShowLabels })}
                    >
                      {data.spikeShowLabels ? 'On' : 'Off'}
                    </button>
                  </div>
                )}
                {(data.spikeShowValues || data.spikeShowLabels) && (
                  <div className="style-row">
                    <span className="style-label">Text size</span>
                    <input
                      type="range"
                      className="style-slider"
                      min={8}
                      max={20}
                      value={data.spikeLabelSize}
                      onChange={e => update({ spikeLabelSize: Number(e.target.value) })}
                    />
                    <span className="style-value">{data.spikeLabelSize}px</span>
                  </div>
                )}
                {data.spikeShowValues && (
                  <>
                    <div className="style-row">
                      <span className="style-label">Commas</span>
                      <button
                        className={`data-toggle-btn ${data.spikeCommas ? 'active' : ''}`}
                        onClick={() => update({ spikeCommas: !data.spikeCommas })}
                      >
                        {data.spikeCommas ? 'On' : 'Off'}
                      </button>
                    </div>
                    <div className="style-row">
                      <span className="style-label">Append</span>
                      <input
                        className="data-unit-input"
                        type="text"
                        placeholder="km², %..."
                        value={data.spikeSuffix}
                        onChange={e => update({ spikeSuffix: e.target.value })}
                      />
                    </div>
                  </>
                )}
              </>
            ) : data.vizType !== 'heatmap' ? (
              <>
                <div className="style-row">
                  <span className="style-label">Color</span>
                  <ColorPickerPopover color={data.pointColor} onChange={c => update({ pointColor: c })} presetColors={DATA_COLORS} />
                </div>

                <div className="style-row">
                  <span className="style-label">Size</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={2}
                    max={20}
                    value={data.pointRadius}
                    onChange={e => update({ pointRadius: Number(e.target.value) })}
                  />
                  <span className="style-value">{data.pointRadius}px</span>
                </div>

                {data.vizType === 'bubbles' && (
                  <div className="style-row">
                    <span className="style-label">Max</span>
                    <input
                      type="range"
                      className="style-slider"
                      min={10}
                      max={60}
                      value={data.maxRadius}
                      onChange={e => update({ maxRadius: Number(e.target.value) })}
                    />
                    <span className="style-value">{data.maxRadius}px</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="style-row">
                  <span className="style-label">Radius</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={5}
                    max={60}
                    value={data.heatmapRadius}
                    onChange={e => update({ heatmapRadius: Number(e.target.value) })}
                  />
                  <span className="style-value">{data.heatmapRadius}px</span>
                </div>

                <div className="style-row">
                  <span className="style-label">Intensity</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={1}
                    max={50}
                    value={Math.round(data.heatmapIntensity * 10)}
                    onChange={e => update({ heatmapIntensity: Number(e.target.value) / 10 })}
                  />
                  <span className="style-value">{data.heatmapIntensity.toFixed(1)}</span>
                </div>

                <div className="style-row">
                  <span className="style-label">Colors</span>
                  <div className="data-ramp-picker">
                    {(['inferno', 'magma', 'plasma', 'viridis'] as const).map(ramp => (
                      <button
                        key={ramp}
                        className={`data-ramp-btn ${data.heatmapColorRamp === ramp ? 'active' : ''}`}
                        onClick={() => update({ heatmapColorRamp: ramp })}
                        title={ramp}
                      >
                        <span className={`data-ramp-swatch data-ramp-${ramp}`} />
                      </button>
                    ))}
                  </div>
                </div>

                {data.valueCol && (
                  <>
                    <p className="data-hint">Weighted by {data.valueCol}</p>
                    <div className="style-row">
                      <span className="style-label">Legend</span>
                      <input
                        type="text"
                        className="data-unit-input"
                        style={{ flex: 1 }}
                        placeholder={data.valueCol}
                        value={data.heatmapLegendTitle}
                        onChange={e => update({ heatmapLegendTitle: e.target.value })}
                      />
                    </div>
                  </>
                )}
              </>
            )}

            <div className="style-row">
              <span className="style-label">Opacity</span>
              <input
                type="range"
                className="style-slider"
                min={10}
                max={100}
                value={Math.round(data.opacity * 100)}
                onChange={e => update({ opacity: Number(e.target.value) / 100 })}
              />
              <span className="style-value">{Math.round(data.opacity * 100)}%</span>
            </div>
          </div>

          {/* Display options — hidden for heatmap and spikes */}
          {data.labelCol && data.vizType !== 'heatmap' && data.vizType !== 'spikes' && (
            <div className="data-display-section">
              <div className="data-columns-header">Display</div>
              <div className="data-display-row">
                <span className="data-display-label">Labels</span>
                <button
                  className={`data-toggle-btn ${data.showLabels ? 'active' : ''}`}
                  onClick={() => update({ showLabels: !data.showLabels })}
                >
                  {data.showLabels ? 'On' : 'Off'}
                </button>
              </div>
              {data.showLabels && (
                <>
                <div className="data-display-row">
                  <span className="data-display-label">Label size</span>
                  <input
                    type="range"
                    className="style-slider"
                    min={8}
                    max={20}
                    value={data.labelSize}
                    onChange={e => update({ labelSize: Number(e.target.value) })}
                  />
                  <span className="style-value">{data.labelSize}px</span>
                </div>
                </>
              )}
              {data.valueCol && (
                <>
                  <div className="data-display-row">
                    <span className="data-display-label">Values</span>
                    <button
                      className={`data-toggle-btn ${data.showValues ? 'active' : ''}`}
                      onClick={() => update({ showValues: !data.showValues })}
                    >
                      {data.showValues ? 'On' : 'Off'}
                    </button>
                  </div>
                  {data.showValues && (
                    <>
                      <div className="data-display-row">
                        <span className="data-display-label">Commas</span>
                        <button
                          className={`data-toggle-btn ${data.formatCommas ? 'active' : ''}`}
                          onClick={() => update({ formatCommas: !data.formatCommas })}
                        >
                          {data.formatCommas ? 'On' : 'Off'}
                        </button>
                      </div>
                      <div className="data-display-row">
                        <span className="data-display-label">Prefix</span>
                        <input
                          className="data-unit-input"
                          type="text"
                          placeholder="$, £..."
                          value={data.valuePrefix}
                          onChange={e => update({ valuePrefix: e.target.value })}
                        />
                      </div>
                      <div className="data-display-row">
                        <span className="data-display-label">Suffix</span>
                        <input
                          className="data-unit-input"
                          type="text"
                          placeholder="km², %..."
                          value={data.valueSuffix}
                          onChange={e => update({ valueSuffix: e.target.value })}
                        />
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
