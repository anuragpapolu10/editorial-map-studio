import { useState, useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import type { Map as MLMap } from 'maplibre-gl';
import type { ShapeStore, ShapeAnnotation } from '../shapes';
import type { ActiveTool } from './Sidebar';
import { setPending } from '../crossSelect';

interface SearchBarProps {
  map: MLMap | null;
  shapeStore: ShapeStore;
  setActiveTool: (tool: ActiveTool) => void;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    city?: string;
    state?: string;
    country?: string;
    osm_value?: string;
    type?: string;
    extent?: [number, number, number, number];
  };
}

function formatResult(p: PhotonFeature['properties']): string {
  const parts: string[] = [];
  if (p.name) parts.push(p.name);
  if (p.city && p.city !== p.name) parts.push(p.city);
  if (p.state && p.state !== p.name) parts.push(p.state);
  if (p.country) parts.push(p.country);
  return parts.join(', ');
}

function zoomForType(p: PhotonFeature['properties']): number {
  const val = p.osm_value || p.type || '';
  if (['continent'].includes(val)) return 3;
  if (['country'].includes(val)) return 5;
  if (['state', 'province', 'region'].includes(val)) return 7;
  if (['county', 'district'].includes(val)) return 9;
  if (['city', 'town'].includes(val)) return 12;
  if (['village', 'hamlet', 'suburb', 'neighbourhood'].includes(val)) return 14;
  return 15;
}

export function SearchBar({ map, shapeStore, setActiveTool }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PhotonFeature[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const pinRef = useRef<maplibregl.Marker | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }

    const coordMatch = q.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (coordMatch) {
      setResults([]);
      return;
    }

    try {
      const res = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en`
      );
      const data = await res.json();
      setResults(data.features || []);
      setShowDropdown(true);
      setActiveIndex(-1);
    } catch {
      setResults([]);
    }
  }, []);

  const handleInput = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value), 250);
  };

  const clearPin = useCallback(() => {
    if (pinRef.current) {
      pinRef.current.remove();
      pinRef.current = null;
    }
  }, []);

  const fetchBoundary = useCallback(async (osmType: string, osmId: number): Promise<GeoJSON.Geometry | null> => {
    const typeMap: Record<string, string> = { R: 'R', W: 'W', N: 'N' };
    const t = typeMap[osmType];
    if (!t) return null;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/details?osmtype=${t}&osmid=${osmId}&polygon_geojson=1&format=json`,
        { headers: { 'User-Agent': 'EditorialMapStudio/1.0' } }
      );
      const data = await res.json();
      const geom = data?.geometry;
      if (geom && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) return geom;
    } catch { /* ignore */ }
    return null;
  }, []);

  const addBoundaryShape = useCallback((geometry: GeoJSON.Geometry) => {
    const rings: [number, number][][] = [];
    if (geometry.type === 'Polygon') {
      rings.push(geometry.coordinates[0] as [number, number][]);
    } else if (geometry.type === 'MultiPolygon') {
      for (const poly of geometry.coordinates) {
        rings.push(poly[0] as [number, number][]);
      }
    }
    let lastId = '';
    for (const ring of rings) {
      const shape: ShapeAnnotation = {
        id: crypto.randomUUID(),
        type: 'polygon',
        vertices: ring,
        rotation: 0,
        stroke: '#c0392b',
        strokeWidth: 2,
        strokeStyle: 'solid',
        fill: '#c0392b',
        fillOpacity: 0.1,
      };
      shapeStore.add(shape);
      lastId = shape.id;
    }
    clearPin();
    if (lastId) {
      setPending('line', lastId);
      setActiveTool('line');
    }
  }, [shapeStore, clearPin, setActiveTool]);

  const dropPin = useCallback((lng: number, lat: number, feature: PhotonFeature) => {
    if (!map) return;
    clearPin();

    const el = document.createElement('div');
    el.className = 'search-pin';

    const dismiss = document.createElement('button');
    dismiss.className = 'search-pin-dismiss';
    dismiss.textContent = '×';
    dismiss.onclick = (e) => { e.stopPropagation(); clearPin(); };
    el.appendChild(dismiss);

    pinRef.current = new maplibregl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(map);

    const osmType = feature.properties.osm_type;
    const osmId = feature.properties.osm_id;
    if (osmType && osmId) {
      fetchBoundary(osmType, osmId).then((geom) => {
        if (geom && pinRef.current) {
          const btn = document.createElement('button');
          btn.className = 'search-pin-boundary';
          btn.textContent = 'Add boundary';
          btn.onclick = (e) => { e.stopPropagation(); addBoundaryShape(geom); };
          el.appendChild(btn);
        }
      });
    }
  }, [map, clearPin, fetchBoundary, addBoundaryShape]);

  const flyTo = (feature: PhotonFeature) => {
    if (!map) return;
    const [lng, lat] = feature.geometry.coordinates;
    const extent = feature.properties.extent;

    if (extent) {
      map.fitBounds(
        [[extent[0], extent[1]], [extent[2], extent[3]]],
        { padding: 40, duration: 1500 }
      );
    } else {
      map.flyTo({
        center: [lng, lat],
        zoom: zoomForType(feature.properties),
        duration: 1500,
      });
    }

    dropPin(lng, lat, feature);
    setQuery(formatResult(feature.properties));
    setShowDropdown(false);
    setResults([]);
  };

  const handleCoordSearch = () => {
    if (!map || !query.trim()) return;
    const coordMatch = query.match(/^\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      map.flyTo({ center: [lng, lat], zoom: 12, duration: 1500 });
      setShowDropdown(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (activeIndex >= 0 && results[activeIndex]) {
        flyTo(results[activeIndex]);
      } else if (results.length > 0) {
        flyTo(results[0]);
      } else {
        handleCoordSearch();
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="search-container" ref={containerRef}>
      <input
        className="search-input"
        type="text"
        placeholder="Search places, countries, coordinates..."
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setShowDropdown(true)}
      />
      {showDropdown && results.length > 0 && (
        <div className="search-dropdown">
          {results.map((feature, i) => (
            <button
              key={i}
              className={`search-result ${i === activeIndex ? 'search-result-active' : ''}`}
              onMouseDown={() => flyTo(feature)}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="search-result-name">
                {feature.properties.name || 'Unknown'}
              </span>
              <span className="search-result-detail">
                {[feature.properties.state, feature.properties.country]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
