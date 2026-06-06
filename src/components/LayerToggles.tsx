import { useState } from 'react';
import type maplibregl from 'maplibre-gl';

interface LayerTogglesProps {
  map: maplibregl.Map | null;
}

interface LayerGroup {
  label: string;
  ids: string[];
  children?: Record<string, { label: string; ids: string[] }>;
}

const LAYER_GROUPS: Record<string, LayerGroup> = {
  water: {
    label: 'Water',
    ids: ['water', 'water_stream', 'water_river'],
  },
  roads: {
    label: 'Roads',
    ids: [
      'roads_runway', 'roads_taxiway', 'roads_pier',
      'roads_tunnels_other_casing', 'roads_tunnels_minor_casing',
      'roads_tunnels_link_casing', 'roads_tunnels_major_casing',
      'roads_tunnels_highway_casing', 'roads_tunnels_other',
      'roads_tunnels_minor', 'roads_tunnels_link',
      'roads_tunnels_major', 'roads_tunnels_highway',
      'roads_minor_service_casing', 'roads_minor_casing',
      'roads_link_casing', 'roads_major_casing_late',
      'roads_highway_casing_late', 'roads_other', 'roads_link',
      'roads_minor_service', 'roads_minor', 'roads_major_casing_early',
      'roads_major', 'roads_highway_casing_early', 'roads_highway',
      'roads_rail',
      'roads_bridges_other_casing', 'roads_bridges_link_casing',
      'roads_bridges_minor_casing', 'roads_bridges_major_casing',
      'roads_bridges_other', 'roads_bridges_minor', 'roads_bridges_link',
      'roads_bridges_major', 'roads_bridges_highway_casing',
      'roads_bridges_highway',
    ],
  },
  buildings: {
    label: 'Buildings',
    ids: ['buildings'],
  },
  boundaries: {
    label: 'Boundaries',
    ids: ['boundaries_country', 'boundaries'],
    children: {
      boundaries_country: {
        label: 'Countries',
        ids: ['boundaries_country'],
      },
      boundaries_region: {
        label: 'States / Provinces',
        ids: ['boundaries'],
      },
    },
  },
  hillshade: {
    label: 'Terrain Relief',
    ids: ['hillshade'],
  },
  parks: {
    label: 'Parks & Land',
    ids: [
      'landcover',
      'landuse_park', 'landuse_urban_green', 'landuse_hospital',
      'landuse_industrial', 'landuse_school', 'landuse_beach',
      'landuse_zoo', 'landuse_aerodrome', 'landuse_pedestrian',
      'landuse_pier', 'landuse_runway',
    ],
  },
  labels: {
    label: 'Labels',
    ids: [
      'address_label', 'water_waterway_label', 'roads_oneway',
      'roads_labels_minor', 'water_label_ocean', 'earth_label_islands',
      'water_label_lakes', 'roads_shields', 'roads_labels_major',
      'places_subplace', 'places_region', 'places_locality',
      'places_country',
    ],
    children: {
      labels_neighborhood: {
        label: 'Neighborhoods',
        ids: ['places_subplace'],
      },
      labels_city: {
        label: 'Cities & Towns',
        ids: ['places_locality'],
      },
      labels_state: {
        label: 'States / Provinces',
        ids: ['places_region'],
      },
      labels_country: {
        label: 'Countries',
        ids: ['places_country'],
      },
      labels_water: {
        label: 'Water Labels',
        ids: ['water_waterway_label', 'water_label_ocean', 'water_label_lakes'],
      },
      labels_roads: {
        label: 'Road Labels',
        ids: ['roads_labels_minor', 'roads_labels_major', 'roads_shields', 'roads_oneway'],
      },
    },
  },
};

function getAllIds(group: LayerGroup): string[] {
  const ids = [...group.ids];
  if (group.children) {
    for (const child of Object.values(group.children)) {
      ids.push(...child.ids);
    }
  }
  return [...new Set(ids)];
}

export function LayerToggles({ map }: LayerTogglesProps) {
  const [satelliteOn, setSatelliteOn] = useState(false);
  const [satelliteOpacity, setSatelliteOpacity] = useState(0.7);

  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const [key, group] of Object.entries(LAYER_GROUPS)) {
      initial[key] = true;
      if (group.children) {
        for (const childKey of Object.keys(group.children)) {
          initial[childKey] = true;
        }
      }
    }
    return initial;
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [boundaryWidth, setBoundaryWidth] = useState(1);
  const [opacities, setOpacities] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const key of Object.keys(LAYER_GROUPS)) {
      initial[key] = 1;
    }
    return initial;
  });

  const changeOpacity = (groupKey: string, val: number) => {
    setOpacities((prev) => ({ ...prev, [groupKey]: val }));
    if (!map) return;
    const group = LAYER_GROUPS[groupKey];
    const ids = getAllIds(group);
    for (const layerId of ids) {
      if (!map.getLayer(layerId)) continue;
      const layer = map.getLayer(layerId)!;
      const type = layer.type;
      // Each layer type has a different opacity property
      if (type === 'fill') map.setPaintProperty(layerId, 'fill-opacity', val);
      else if (type === 'line') map.setPaintProperty(layerId, 'line-opacity', val);
      else if (type === 'symbol') map.setPaintProperty(layerId, 'text-opacity', val);
      else if (type === 'hillshade') map.setPaintProperty(layerId, 'hillshade-exaggeration', val * 0.7);
      else if (type === 'raster') map.setPaintProperty(layerId, 'raster-opacity', val);
    }
  };

  const toggleSatellite = () => {
    if (!map) return;
    const next = !satelliteOn;
    setSatelliteOn(next);
    map.setPaintProperty('satellite', 'raster-opacity', next ? satelliteOpacity : 0);
  };

  const changeSatelliteOpacity = (val: number) => {
    setSatelliteOpacity(val);
    if (!map || !satelliteOn) return;
    map.setPaintProperty('satellite', 'raster-opacity', val);
  };

  const setLayers = (ids: string[], visible: boolean) => {
    if (!map) return;
    const value = visible ? 'visible' : 'none';
    for (const layerId of ids) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', value);
      }
    }
  };

  const toggleGroup = (groupKey: string) => {
    if (!map) return;
    const group = LAYER_GROUPS[groupKey];
    const newVisible = !visibility[groupKey];

    setLayers(getAllIds(group), newVisible);

    setVisibility((prev) => {
      const next = { ...prev, [groupKey]: newVisible };
      if (group.children) {
        for (const childKey of Object.keys(group.children)) {
          next[childKey] = newVisible;
        }
      }
      return next;
    });
  };

  const toggleChild = (parentKey: string, childKey: string) => {
    if (!map) return;
    const group = LAYER_GROUPS[parentKey];
    const child = group.children?.[childKey];
    if (!child) return;

    const newVisible = !visibility[childKey];
    setLayers(child.ids, newVisible);

    setVisibility((prev) => {
      const next = { ...prev, [childKey]: newVisible };
      if (group.children) {
        const allChildrenOff = Object.keys(group.children).every(
          (k) => !(k === childKey ? newVisible : next[k] ?? prev[k])
        );
        const anyChildOn = Object.keys(group.children).some(
          (k) => (k === childKey ? newVisible : next[k] ?? prev[k])
        );
        next[parentKey] = anyChildOn;
      }
      return next;
    });
  };

  return (
    <div className="layer-toggles">
      {/* Satellite imagery */}
      <div className="layer-group">
        <div className="layer-toggle-row">
          <label className="layer-toggle">
            <input
              type="checkbox"
              checked={satelliteOn}
              onChange={toggleSatellite}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
            <span className="toggle-label">Satellite</span>
          </label>
        </div>
        {satelliteOn && (
          <div className="layer-children" style={{ borderLeft: 'none', marginLeft: 0, paddingLeft: 0 }}>
            <div className="layer-slider-row">
              <span className="layer-slider-label">Opacity</span>
              <input
                type="range"
                min="0.05"
                max="1"
                step="0.05"
                value={satelliteOpacity}
                onChange={(e) => changeSatelliteOpacity(Number(e.target.value))}
                className="layer-slider"
              />
              <span className="layer-slider-value">{Math.round(satelliteOpacity * 100)}%</span>
            </div>
          </div>
        )}
      </div>

      {Object.entries(LAYER_GROUPS).map(([key, group]) => (
        <div key={key} className="layer-group">
          <div className="layer-toggle-row">
            <label className="layer-toggle">
              <input
                type="checkbox"
                checked={visibility[key]}
                onChange={() => toggleGroup(key)}
              />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
              <span className="toggle-label">{group.label}</span>
            </label>
            <button
              className={`layer-chevron-btn ${expanded[key] ? 'layer-chevron-open' : ''}`}
              onClick={() => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))}
              title={`${group.label} options`}
            >
              <svg className="chevron-icon" viewBox="0 0 10 6" width="10" height="6">
                <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
          {expanded[key] && (
            <div className="layer-children">
              {/* Child toggles (if any) */}
              {group.children && Object.entries(group.children).map(([childKey, child]) => (
                <label key={childKey} className="layer-toggle layer-toggle-child">
                  <input
                    type="checkbox"
                    checked={visibility[childKey]}
                    onChange={() => toggleChild(key, childKey)}
                  />
                  <span className="toggle-track toggle-track-small">
                    <span className="toggle-thumb toggle-thumb-small" />
                  </span>
                  <span className="toggle-label">{child.label}</span>
                </label>
              ))}
              {/* Boundary thickness (boundaries only) */}
              {key === 'boundaries' && (
                <div className="layer-slider-row">
                  <span className="layer-slider-label">Thickness</span>
                  <input
                    type="range"
                    min="0.2"
                    max="5"
                    step="0.1"
                    value={boundaryWidth}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      setBoundaryWidth(val);
                      if (!map) return;
                      for (const id of ['boundaries_country', 'boundaries']) {
                        if (map.getLayer(id)) {
                          map.setPaintProperty(id, 'line-width', val);
                        }
                      }
                    }}
                    className="layer-slider"
                  />
                  <span className="layer-slider-value">{boundaryWidth.toFixed(1)}</span>
                </div>
              )}
              {/* Opacity slider (all groups) */}
              <div className="layer-slider-row">
                <span className="layer-slider-label">Opacity</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={opacities[key]}
                  onChange={(e) => changeOpacity(key, Number(e.target.value))}
                  className="layer-slider"
                />
                <span className="layer-slider-value">{Math.round(opacities[key] * 100)}%</span>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
