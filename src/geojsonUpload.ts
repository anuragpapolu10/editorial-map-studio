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

  if (file.name.endsWith('.gpx')) {
    const text = await file.text();
    const fc = parseGpx(text);
    const columns = extractColumns(fc);
    return { name, geojson: fc, columns };
  }

  if (file.name.endsWith('.kml')) {
    const text = await file.text();
    const fc = parseKml(text);
    const columns = extractColumns(fc);
    return { name, geojson: fc, columns };
  }

  const text = await file.text();
  const parsed = JSON.parse(text);
  const fc = normalizeToFeatureCollection(parsed);
  const columns = extractColumns(fc);
  return { name, geojson: fc, columns };
}

function parseGpx(text: string): GeoJSON.FeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const features: GeoJSON.Feature[] = [];

  function getCoord(el: Element): [number, number, number?] {
    const lon = parseFloat(el.getAttribute('lon')!);
    const lat = parseFloat(el.getAttribute('lat')!);
    const eleEl = el.querySelector('ele');
    return eleEl ? [lon, lat, parseFloat(eleEl.textContent!)] : [lon, lat];
  }

  function getProps(el: Element): Record<string, string> {
    const props: Record<string, string> = {};
    const nameEl = el.querySelector(':scope > name');
    if (nameEl?.textContent) props.name = nameEl.textContent;
    const descEl = el.querySelector(':scope > desc');
    if (descEl?.textContent) props.desc = descEl.textContent;
    const typeEl = el.querySelector(':scope > type');
    if (typeEl?.textContent) props.type = typeEl.textContent;
    return props;
  }

  for (const wpt of doc.querySelectorAll('wpt')) {
    features.push({
      type: 'Feature',
      properties: getProps(wpt),
      geometry: { type: 'Point', coordinates: getCoord(wpt) },
    });
  }

  for (const trk of doc.querySelectorAll('trk')) {
    const props = getProps(trk);
    const segments = trk.querySelectorAll('trkseg');
    for (const seg of segments) {
      const coords = Array.from(seg.querySelectorAll('trkpt')).map(getCoord);
      if (coords.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { ...props },
          geometry: { type: 'LineString', coordinates: coords },
        });
      }
    }
  }

  for (const rte of doc.querySelectorAll('rte')) {
    const props = getProps(rte);
    const coords = Array.from(rte.querySelectorAll('rtept')).map(getCoord);
    if (coords.length >= 2) {
      features.push({
        type: 'Feature',
        properties: props,
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }

  if (features.length === 0) throw new Error('No waypoints, tracks, or routes found in GPX file');
  return { type: 'FeatureCollection', features };
}

function parseKml(text: string): GeoJSON.FeatureCollection {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const features: GeoJSON.Feature[] = [];

  function parseCoords(text: string): number[][] {
    return text.trim().split(/\s+/).map(s => {
      const parts = s.split(',').map(Number);
      return parts.length >= 3 ? [parts[0], parts[1], parts[2]] : [parts[0], parts[1]];
    }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));
  }

  function parseGeometry(el: Element): GeoJSON.Geometry | null {
    const point = el.querySelector(':scope > Point > coordinates');
    if (point?.textContent) {
      const coords = parseCoords(point.textContent);
      if (coords.length > 0) return { type: 'Point', coordinates: coords[0] };
    }

    const lineString = el.querySelector(':scope > LineString > coordinates');
    if (lineString?.textContent) {
      const coords = parseCoords(lineString.textContent);
      if (coords.length >= 2) return { type: 'LineString', coordinates: coords };
    }

    const polygon = el.querySelector(':scope > Polygon');
    if (polygon) {
      const rings: number[][][] = [];
      const outer = polygon.querySelector('outerBoundaryIs LinearRing coordinates');
      if (outer?.textContent) {
        rings.push(parseCoords(outer.textContent));
      }
      for (const inner of polygon.querySelectorAll('innerBoundaryIs LinearRing coordinates')) {
        if (inner.textContent) rings.push(parseCoords(inner.textContent));
      }
      if (rings.length > 0 && rings[0].length >= 4) return { type: 'Polygon', coordinates: rings };
    }

    const multi = el.querySelector(':scope > MultiGeometry');
    if (multi) {
      const geoms: GeoJSON.Geometry[] = [];
      for (const child of multi.children) {
        const wrapper = document.createElement('div');
        wrapper.appendChild(child.cloneNode(true));
        const g = parseGeometry(wrapper);
        if (g) geoms.push(g);
      }
      if (geoms.length === 1) return geoms[0];
      if (geoms.length > 1) return { type: 'GeometryCollection', geometries: geoms };
    }

    return null;
  }

  for (const pm of doc.querySelectorAll('Placemark')) {
    const props: Record<string, string> = {};
    const nameEl = pm.querySelector(':scope > name');
    if (nameEl?.textContent) props.name = nameEl.textContent;
    const descEl = pm.querySelector(':scope > description');
    if (descEl?.textContent) props.description = descEl.textContent;

    const extData = pm.querySelector(':scope > ExtendedData');
    if (extData) {
      for (const data of extData.querySelectorAll('Data, SimpleData')) {
        const key = data.getAttribute('name');
        const val = data.querySelector('value')?.textContent ?? data.textContent;
        if (key && val) props[key] = val;
      }
    }

    const geometry = parseGeometry(pm);
    if (geometry) {
      features.push({ type: 'Feature', properties: props, geometry });
    }
  }

  if (features.length === 0) throw new Error('No placemarks found in KML file');
  return { type: 'FeatureCollection', features };
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
