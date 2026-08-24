import shp from 'shpjs';

export interface UploadedGeoData {
  name: string;
  geojson: GeoJSON.FeatureCollection;
  columns: string[];
}

export async function parseGeoFile(file: File): Promise<UploadedGeoData> {
  const name = file.name.replace(/\.[^.]+$/, '');

  if (file.name.endsWith('.zip') || file.name.endsWith('.shp')) {
    const buffer = await file.arrayBuffer();
    const result = await shp(buffer);
    const fc = Array.isArray(result) ? result[0] : result;
    const columns = extractColumns(fc);
    return { name, geojson: fc, columns };
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  const fc = normalizeToFeatureCollection(parsed);
  const columns = extractColumns(fc);
  return { name, geojson: fc, columns };
}

function normalizeToFeatureCollection(data: any): GeoJSON.FeatureCollection {
  if (data.type === 'FeatureCollection') return data;
  if (data.type === 'Feature') {
    return { type: 'FeatureCollection', features: [data] };
  }
  if (data.type && data.coordinates) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: data, properties: {} }],
    };
  }
  throw new Error('Unrecognized GeoJSON structure');
}

function extractColumns(fc: GeoJSON.FeatureCollection): string[] {
  const keys = new Set<string>();
  for (const f of fc.features) {
    if (f.properties) {
      for (const k of Object.keys(f.properties)) keys.add(k);
    }
  }
  return Array.from(keys);
}

export function getGeometryType(fc: GeoJSON.FeatureCollection): 'polygon' | 'line' | 'point' | 'mixed' {
  const types = new Set<string>();
  for (const f of fc.features) {
    const t = f.geometry.type;
    if (t === 'Polygon' || t === 'MultiPolygon') types.add('polygon');
    else if (t === 'LineString' || t === 'MultiLineString') types.add('line');
    else if (t === 'Point' || t === 'MultiPoint') types.add('point');
  }
  if (types.size > 1) return 'mixed';
  if (types.has('polygon')) return 'polygon';
  if (types.has('line')) return 'line';
  return 'point';
}

export function getBounds(fc: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let count = 0;

  function processCoord(coord: number[]) {
    minLng = Math.min(minLng, coord[0]);
    minLat = Math.min(minLat, coord[1]);
    maxLng = Math.max(maxLng, coord[0]);
    maxLat = Math.max(maxLat, coord[1]);
    count++;
  }

  function processCoords(coords: any) {
    if (typeof coords[0] === 'number') {
      processCoord(coords);
    } else {
      for (const c of coords) processCoords(c);
    }
  }

  for (const f of fc.features) {
    const g = f.geometry as any;
    if (g.coordinates) processCoords(g.coordinates);
  }

  if (count === 0) return null;
  return [minLng, minLat, maxLng, maxLat];
}
