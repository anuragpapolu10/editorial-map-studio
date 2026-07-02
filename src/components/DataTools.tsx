import { useState, useEffect, useCallback, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { DataState, DataRow, HeatmapLegendInfo } from '../dataStore';
import {
  DEFAULT_DATA_STATE, ANCHOR_POSITIONS,
  parseCSV, autoDetectColumns, extractPoints, getSkippedRows,
  getValueRange, pointsToGeoJSON, getSampleCSV, geocodeLocations,
} from '../dataStore';
import { ColorPickerPopover } from './ColorPickerPopover';

const SOURCE_ID = 'data-points-source';
const LAYER_ID = 'data-points-layer';
const LABEL_LAYER_ID = 'data-labels-layer';
const HEATMAP_LAYER_ID = 'data-heatmap-layer';

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

  const handleGeocode = useCallback(async (locationCol: string, rows: DataRow[], columns: string[], bias: string) => {
    setGeocoding({ active: true, done: 0, total: 0 });
    const results = await geocodeLocations(rows, locationCol, (done, total) => {
      setGeocoding({ active: true, done, total });
    }, bias.trim());

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
    if (data.vizType !== 'heatmap') {
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

  // Manage label layer
  useEffect(() => {
    if (!map || !sourceAdded.current) return;

    const wantLabels = data.showLabels && data.labelCol;
    const wantValues = data.showValues && data.valueCol;

    if (wantLabels || wantValues) {
      let textField: maplibregl.ExpressionSpecification;
      if (wantLabels && wantValues) {
        textField = ['concat', ['get', 'label'], '\n', ['get', 'formattedValue']];
      } else if (wantLabels) {
        textField = ['get', 'label'];
      } else {
        textField = ['get', 'formattedValue'];
      }

      const anchorExpr: maplibregl.ExpressionSpecification = [
        'match', ['get', '_anchor'],
        'top', 'bottom',
        'bottom', 'top',
        'left', 'right',
        'right', 'left',
        'bottom',
      ];

      const points = extractPoints(data);
      const { min, max } = getValueRange(points);
      let radialOffset: maplibregl.ExpressionSpecification;

      if (data.vizType === 'bubbles' && data.valueCol) {
        // Scale radial offset with bubble radius: radius_px / text_size + gap
        const radiusExpr: maplibregl.ExpressionSpecification = [
          'interpolate', ['linear'],
          ['coalesce', ['get', 'value'], min],
          min, data.pointRadius,
          max, data.maxRadius,
        ];
        radialOffset = ['+', ['/', radiusExpr, data.labelSize], 0.4] as maplibregl.ExpressionSpecification;
      } else {
        radialOffset = 0.8 as any;
      }

      if (!map.getLayer(LABEL_LAYER_ID)) {
        map.addLayer({
          id: LABEL_LAYER_ID,
          type: 'symbol',
          source: SOURCE_ID,
          layout: {
            'text-field': textField,
            'text-size': data.labelSize,
            'text-anchor': anchorExpr,
            'text-radial-offset': radialOffset,
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
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-field', textField);
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-size', data.labelSize);
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-anchor', anchorExpr);
        map.setLayoutProperty(LABEL_LAYER_ID, 'text-radial-offset', radialOffset);
      }
    } else {
      if (map.getLayer(LABEL_LAYER_ID)) {
        map.removeLayer(LABEL_LAYER_ID);
      }
    }
  }, [map, data.showLabels, data.showValues, data.labelCol, data.valueCol, data.labelSize, data.rows, data.labelAnchors, data.formatCommas, data.valuePrefix, data.valueSuffix, data.vizType, data.pointRadius, data.maxRadius]);

  // Click label to cycle position
  useEffect(() => {
    if (!map) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      if (!map.getLayer(LABEL_LAYER_ID)) return;
      const features = map.queryRenderedFeatures(e.point, { layers: [LABEL_LAYER_ID] });
      if (features.length === 0) return;
      const idx = features[0].properties?._idx;
      if (idx == null) return;
      setData(prev => {
        const current = prev.labelAnchors[idx] ?? 0;
        const next = (current + 1) % ANCHOR_POSITIONS.length;
        return { ...prev, labelAnchors: { ...prev.labelAnchors, [idx]: next } };
      });
    };

    const onEnter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const onLeave = () => { map.getCanvas().style.cursor = ''; };

    map.on('click', LABEL_LAYER_ID, onClick);
    map.on('mouseenter', LABEL_LAYER_ID, onEnter);
    map.on('mouseleave', LABEL_LAYER_ID, onLeave);

    return () => {
      map.off('click', LABEL_LAYER_ID, onClick);
      map.off('mouseenter', LABEL_LAYER_ID, onEnter);
      map.off('mouseleave', LABEL_LAYER_ID, onLeave);
    };
  }, [map]);

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
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(HEATMAP_LAYER_ID)) map.removeLayer(HEATMAP_LAYER_ID);
        if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
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
      {hasData && !hasCoords && !geocoding.active && data.labelCol && (
        <div className="data-geocode-prompt">
          <p>No coordinates found. Geocode using the <strong>{data.labelCol}</strong> column?</p>
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
              onClick={() => handleGeocode(data.labelCol!, data.rows, data.columns, regionBias)}
            >
              Yes, geocode
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
              className={`data-viz-type-btn ${data.vizType === 'heatmap' ? 'active' : ''}`}
              onClick={() => update({ vizType: 'heatmap' })}
            >
              Heatmap
            </button>
          </div>

          {/* Style controls */}
          <div className="data-style-section">
            {data.vizType !== 'heatmap' ? (
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

          {/* Display options — hidden for heatmap */}
          {data.labelCol && data.vizType !== 'heatmap' && (
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
                <p className="data-hint">Click a label on the map to reposition it</p>
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
