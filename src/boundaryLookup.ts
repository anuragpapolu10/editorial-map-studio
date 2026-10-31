import type { DataRow } from './dataStore';

export interface BoundaryType {
  id: string;
  name: string;
  description: string;
  group: 'nyc' | 'us' | 'world';
  columnPatterns: RegExp[];
  valuePattern?: RegExp;
  fetchUrl: string;
  joinFields: string[];
  filterCountry?: string; // ISO-2 code to filter admin1 features by country
}

// ── NYC Open Data boundaries ──────────────────────────────────────
const NYC_BOUNDARIES: BoundaryType[] = [
  {
    id: 'nyc-nta',
    name: 'Neighborhoods (NTA)',
    description: '2020 Neighborhood Tabulation Areas',
    group: 'nyc',
    columnPatterns: [/^nta[_\s-]?code$/i, /^ntacode$/i, /^nta2020$/i, /^nta$/i, /^nta[_\s-]?id$/i],
    valuePattern: /^[A-Z]{2}\d{4}/,
    fetchUrl: 'https://data.cityofnewyork.us/resource/9nt8-h7nd.geojson?$limit=300',
    joinFields: ['nta2020', 'ntacode', 'nta_code', 'NTA2020', 'NTACode', 'nta'],
  },
  {
    id: 'nyc-cd',
    name: 'Community Districts',
    description: 'NYC community district boundaries',
    group: 'nyc',
    columnPatterns: [/^(community[_\s-]?district|cd[_\s-]?code|boro[_\s-]?cd|comm[_\s-]?dist)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/5crt-au7u.geojson?$limit=100',
    joinFields: ['boro_cd', 'BORO_CD', 'borocd', 'BoroCD'],
  },
  {
    id: 'nyc-zip',
    name: 'ZIP Codes',
    description: 'Modified ZIP Code Tabulation Areas',
    group: 'nyc',
    columnPatterns: [/^(zip[_\s-]?code|zipcode|zip|postal[_\s-]?code|zcta|modzcta)$/i],
    valuePattern: /^\d{5}$/,
    fetchUrl: 'https://data.cityofnewyork.us/resource/pri4-ifjk.geojson?$limit=200',
    joinFields: ['modzcta', 'MODZCTA', 'zipcode', 'zcta'],
  },
  {
    id: 'nyc-census-tract',
    name: 'Census Tracts',
    description: '2020 Census tract boundaries',
    group: 'nyc',
    columnPatterns: [/^(census[_\s-]?tract|tract[_\s-]?id|geoid|ct2020|censustract|tract)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/63ge-mke6.geojson?$limit=2500',
    joinFields: ['ct2020', 'CT2020', 'geoid', 'GEOID', 'geoid20', 'GEOID20', 'tractce', 'TRACTCE'],
  },
  {
    id: 'nyc-precinct',
    name: 'Police Precincts',
    description: 'NYPD precinct boundaries',
    group: 'nyc',
    columnPatterns: [/^(precinct|pct|police[_\s-]?precinct|nypd[_\s-]?precinct)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/y76i-bdw7.geojson?$limit=100',
    joinFields: ['precinct', 'Precinct', 'PRECINCT'],
  },
  {
    id: 'nyc-council',
    name: 'City Council Districts',
    description: 'NYC City Council district boundaries',
    group: 'nyc',
    columnPatterns: [/^(council[_\s-]?dist(rict)?|coun[_\s-]?dist|city[_\s-]?council)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/872g-cjhh.geojson?$limit=60',
    joinFields: ['coundist', 'CounDist', 'COUNDIST'],
  },
  {
    id: 'nyc-congress',
    name: 'Congressional Districts',
    description: 'US Congressional district boundaries (NYC)',
    group: 'nyc',
    columnPatterns: [/^(cong(ressional)?[_\s-]?dist(rict)?|cong[_\s-]?dist)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/j3u5-usz2.geojson?$limit=20',
    joinFields: ['cong_dist', 'CongDist', 'CONG_DIST'],
  },
  {
    id: 'nyc-assembly',
    name: 'State Assembly Districts',
    description: 'NY State Assembly district boundaries',
    group: 'nyc',
    columnPatterns: [/^(assembly[_\s-]?dist(rict)?|assem[_\s-]?dist|state[_\s-]?assembly)$/i],
    fetchUrl: 'https://data.cityofnewyork.us/resource/5yfv-9hkp.geojson?$limit=70',
    joinFields: ['assembly_district', 'AssemDist', 'ASSEM_DIST'],
  },
  {
    id: 'nyc-puma',
    name: 'PUMAs',
    description: '2020 Public Use Microdata Areas',
    group: 'nyc',
    columnPatterns: [/^(puma|puma[_\s-]?code|puma[_\s-]?id|puma2020)$/i],
    valuePattern: /^\d{4}$/,
    fetchUrl: 'https://data.cityofnewyork.us/resource/pikk-p9nv.geojson?$limit=60',
    joinFields: ['puma', 'PUMA', 'puma2020'],
  },
];

// ── Natural Earth URLs ────────────────────────────────────────────
const NE_COUNTRIES_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson';
const NE_ADMIN1_URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';

// ── World / national boundaries ───────────────────────────────────
const WORLD_BOUNDARIES: BoundaryType[] = [
  {
    id: 'world-countries',
    name: 'World Countries',
    description: 'Country boundaries (Natural Earth)',
    group: 'world',
    columnPatterns: [
      /^(country|country[_\s-]?(name|code)|nation|iso[_\s-]?a[23]?|iso[_\s-]?code|country[_\s-]?iso)$/i,
    ],
    fetchUrl: NE_COUNTRIES_URL,
    joinFields: ['NAME', 'NAME_EN', 'ISO_A2', 'ISO_A3', 'ADMIN', 'ABBREV', 'POSTAL', 'ISO_A2_EH', 'ISO_A3_EH', 'FORMAL_EN'],
  },
  {
    id: 'us-states',
    name: 'US States',
    description: 'US state boundaries (Natural Earth)',
    group: 'us',
    columnPatterns: [
      /^(state|state[_\s-]?(name|code|abbr)|us[_\s-]?state|stusab|stusps)$/i,
    ],
    fetchUrl: NE_ADMIN1_URL,
    joinFields: ['name', 'postal', 'iso_3166_2', 'abbrev', 'fips', 'name_en', 'name_alt', 'woe_name', 'gn_name'],
    filterCountry: 'US',
  },
];

// ── Per-country admin1 entries (states/provinces/prefectures) ─────
interface CountryAdmin1 {
  id: string;
  name: string;
  description: string;
  iso: string;
  columnPatterns: RegExp[];
}

const COUNTRY_ADMIN1: CountryAdmin1[] = [
  { id: 'gb-regions', name: 'UK Regions', description: 'Counties, boroughs & districts', iso: 'GB',
    columnPatterns: [/^(region|county|constituency|local[_\s-]?authority|council|borough|district)$/i] },
  { id: 'de-states', name: 'Germany States', description: 'Bundesländer', iso: 'DE',
    columnPatterns: [/^(bundesland|land|state|region|kreis)$/i] },
  { id: 'fr-departments', name: 'France Departments', description: 'Départements & régions', iso: 'FR',
    columnPatterns: [/^(d[ée]partement|region|r[ée]gion|department)$/i] },
  { id: 'es-regions', name: 'Spain Regions', description: 'Comunidades autónomas & provincias', iso: 'ES',
    columnPatterns: [/^(comunidad|provincia|region|autonomous[_\s-]?community)$/i] },
  { id: 'br-states', name: 'Brazil States', description: 'Estados', iso: 'BR',
    columnPatterns: [/^(estado|state|uf|sigla[_\s-]?uf)$/i] },
  { id: 'it-provinces', name: 'Italy Provinces', description: 'Province & regioni', iso: 'IT',
    columnPatterns: [/^(provincia|province|regione|region)$/i] },
  { id: 'in-states', name: 'India States', description: 'States & union territories', iso: 'IN',
    columnPatterns: [/^(state|state[_\s-]?name|ut|union[_\s-]?territory|pradesh)$/i] },
  { id: 'jp-prefectures', name: 'Japan Prefectures', description: '都道府県', iso: 'JP',
    columnPatterns: [/^(prefecture|ken|to|fu|do|todofuken|都道府県)$/i] },
  { id: 'ph-provinces', name: 'Philippines Provinces', description: 'Provinces & regions', iso: 'PH',
    columnPatterns: [/^(province|lalawigan|region)$/i] },
  { id: 'au-states', name: 'Australia States', description: 'States & territories', iso: 'AU',
    columnPatterns: [/^(state|territory|state[_\s-]?territory)$/i] },
  { id: 'nz-regions', name: 'New Zealand Regions', description: 'Regional councils', iso: 'NZ',
    columnPatterns: [/^(region|regional[_\s-]?council)$/i] },
  { id: 'za-provinces', name: 'South Africa Provinces', description: 'Provinces', iso: 'ZA',
    columnPatterns: [/^(province|provinsie)$/i] },
  { id: 'ke-counties', name: 'Kenya Counties', description: 'Counties', iso: 'KE',
    columnPatterns: [/^(county|kaunti)$/i] },
];

function countryAdmin1ToBoundary(ca: CountryAdmin1): BoundaryType {
  return {
    id: ca.id,
    name: ca.name,
    description: ca.description,
    group: 'world',
    columnPatterns: ca.columnPatterns,
    fetchUrl: NE_ADMIN1_URL,
    joinFields: ['name', 'name_en', 'postal', 'abbrev', 'iso_3166_2', 'name_alt', 'woe_name', 'gn_name', 'gns_name', 'name_local'],
    filterCountry: ca.iso,
  };
}

export const BUILT_IN_BOUNDARIES: BoundaryType[] = [
  ...NYC_BOUNDARIES,
  ...WORLD_BOUNDARIES,
  ...COUNTRY_ADMIN1.map(countryAdmin1ToBoundary),
];

export const BOUNDARY_GROUPS: { key: string; label: string }[] = [
  { key: 'nyc', label: 'New York City' },
  { key: 'us', label: 'United States' },
  { key: 'world', label: 'World / Countries' },
];

const boundaryCache = new Map<string, GeoJSON.FeatureCollection>();

export function detectBoundaryType(
  columns: string[],
  rows: DataRow[],
): { type: BoundaryType; column: string } | null {
  for (const bt of BUILT_IN_BOUNDARIES) {
    for (const col of columns) {
      const match = bt.columnPatterns.some(p => p.test(col));
      if (!match) continue;

      if (bt.valuePattern && rows.length > 0) {
        const samples = rows.slice(0, 10).map(r => (r[col] ?? '').trim()).filter(Boolean);
        if (samples.length > 0) {
          const matchRate = samples.filter(v => bt.valuePattern!.test(v)).length / samples.length;
          if (matchRate < 0.4) continue;
        }
      }

      return { type: bt, column: col };
    }
  }
  return null;
}

export async function fetchBoundaryGeoJSON(
  url: string,
  onProgress?: (msg: string) => void,
  filterCountry?: string,
): Promise<GeoJSON.FeatureCollection> {
  const cacheKey = filterCountry ? `${url}::${filterCountry}` : url;
  if (boundaryCache.has(cacheKey)) return boundaryCache.get(cacheKey)!;

  onProgress?.('Fetching boundaries...');
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch boundaries (${res.status})`);
  onProgress?.('Parsing...');
  const data = await res.json();
  let fc = data as GeoJSON.FeatureCollection;

  if (filterCountry) {
    fc = {
      type: 'FeatureCollection',
      features: fc.features.filter(f => {
        const iso = f.properties?.iso_a2 ?? f.properties?.ISO_A2 ?? '';
        return iso === filterCountry;
      }),
    };
  }

  boundaryCache.set(cacheKey, fc);
  // Also cache the unfiltered version if we fetched the full file
  if (filterCountry && !boundaryCache.has(url)) {
    boundaryCache.set(url, data as GeoJSON.FeatureCollection);
  }
  return fc;
}

export function findJoinField(
  geojson: GeoJSON.FeatureCollection,
  candidates: string[],
): string | null {
  if (geojson.features.length === 0) return null;
  const props = geojson.features[0].properties ?? {};
  const keys = Object.keys(props);
  const keysLower = keys.map(k => k.toLowerCase());

  for (const c of candidates) {
    const idx = keysLower.indexOf(c.toLowerCase());
    if (idx !== -1) return keys[idx];
  }
  return null;
}

export function getFieldNames(geojson: GeoJSON.FeatureCollection): string[] {
  if (geojson.features.length === 0) return [];
  return Object.keys(geojson.features[0].properties ?? {});
}

function computeCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
  // Collect all outer rings, then use centroid of the largest one
  // so island chains don't pull the point into the ocean
  const rings: number[][][] = [];

  function collect(g: GeoJSON.Geometry) {
    switch (g.type) {
      case 'Point':
        rings.push([g.coordinates as number[]]);
        break;
      case 'Polygon':
        rings.push(g.coordinates[0] as number[][]);
        break;
      case 'MultiPolygon':
        for (const poly of g.coordinates) rings.push(poly[0] as number[][]);
        break;
      case 'GeometryCollection':
        for (const gg of (g as GeoJSON.GeometryCollection).geometries) collect(gg);
        break;
    }
  }

  collect(geometry);
  if (rings.length === 0) return null;

  // Find the largest ring by area
  let bestRing = rings[0];
  let maxArea = -1;
  for (const ring of rings) {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const j = (i + 1) % n;
      a += ring[i][0] * ring[j][1];
      a -= ring[j][0] * ring[i][1];
    }
    a = Math.abs(a) / 2;
    if (a > maxArea) { maxArea = a; bestRing = ring; }
  }

  let sumLng = 0, sumLat = 0;
  for (const c of bestRing) { sumLng += c[0]; sumLat += c[1]; }
  return [sumLng / bestRing.length, sumLat / bestRing.length];
}

export function deduplicateFeatures(
  fc: GeoJSON.FeatureCollection,
  joinField: string,
): GeoJSON.FeatureCollection {
  const grouped = new Map<string, GeoJSON.Feature[]>();
  for (const f of fc.features) {
    const key = normalize(String(f.properties?.[joinField] ?? ''));
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(f);
  }

  const merged: GeoJSON.Feature[] = [];
  for (const [, features] of grouped) {
    if (features.length === 1) {
      merged.push(features[0]);
      continue;
    }
    // Merge all polygons into one MultiPolygon, keep properties from the largest
    let best = features[0];
    let maxArea = -1;
    const allPolygons: number[][][][] = [];
    for (const f of features) {
      const a = approxArea(f.geometry);
      if (a > maxArea) { maxArea = a; best = f; }
      collectPolygons(f.geometry, allPolygons);
    }
    merged.push({
      type: 'Feature',
      properties: best.properties,
      geometry: { type: 'MultiPolygon', coordinates: allPolygons },
    });
  }

  return { type: 'FeatureCollection', features: merged };
}

function collectPolygons(g: GeoJSON.Geometry, out: number[][][][]) {
  if (g.type === 'Polygon') out.push(g.coordinates as number[][][]);
  else if (g.type === 'MultiPolygon') {
    for (const p of g.coordinates) out.push(p as number[][][]);
  } else if (g.type === 'GeometryCollection') {
    for (const gg of (g as GeoJSON.GeometryCollection).geometries) collectPolygons(gg, out);
  }
}

export interface BoundaryJoinResult {
  newRows: DataRow[];
  newColumns: string[];
  matched: number;
  total: number;
  unmatched: string[];
}

function approxArea(geometry: GeoJSON.Geometry): number {
  let area = 0;
  function ringArea(ring: number[][]) {
    let a = 0;
    for (let i = 0, n = ring.length; i < n; i++) {
      const j = (i + 1) % n;
      a += ring[i][0] * ring[j][1];
      a -= ring[j][0] * ring[i][1];
    }
    return Math.abs(a) / 2;
  }
  function collect(g: GeoJSON.Geometry) {
    if (g.type === 'Polygon') {
      area += ringArea(g.coordinates[0]);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates) area += ringArea(poly[0]);
    } else if (g.type === 'GeometryCollection') {
      for (const gg of (g as GeoJSON.GeometryCollection).geometries) collect(gg);
    }
  }
  collect(geometry);
  return area;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function joinWithBoundaries(
  rows: DataRow[],
  columns: string[],
  csvCodeCol: string,
  geojson: GeoJSON.FeatureCollection,
  geoJoinField: string,
): BoundaryJoinResult {
  // Group features by normalized name, then pick the largest polygon per name
  // so the centroid lands on the main landmass (not a small island)
  const featuresByCode = new Map<string, GeoJSON.Feature[]>();
  for (const feature of geojson.features) {
    const code = normalize(String(feature.properties?.[geoJoinField] ?? ''));
    if (!code || !feature.geometry) continue;
    if (!featuresByCode.has(code)) featuresByCode.set(code, []);
    featuresByCode.get(code)!.push(feature);
  }

  const centroidMap = new Map<string, [number, number]>();
  for (const [code, features] of featuresByCode) {
    let best = features[0];
    if (features.length > 1) {
      let maxArea = -1;
      for (const f of features) {
        const a = approxArea(f.geometry);
        if (a > maxArea) { maxArea = a; best = f; }
      }
    }
    const centroid = computeCentroid(best.geometry);
    if (centroid) centroidMap.set(code, centroid);
  }

  const latCol = '_boundary_lat';
  const lngCol = '_boundary_lng';
  let matched = 0;
  const unmatchedCodes: string[] = [];

  const newRows = rows.map(row => {
    const code = normalize(row[csvCodeCol] ?? '');
    const centroid = centroidMap.get(code);
    if (centroid) {
      matched++;
      return { ...row, [latCol]: String(centroid[1]), [lngCol]: String(centroid[0]) };
    }
    if (code) unmatchedCodes.push(row[csvCodeCol] ?? code);
    return { ...row, [latCol]: '', [lngCol]: '' };
  });

  const newColumns = columns.includes(latCol) ? columns : [...columns, latCol, lngCol];

  return {
    newRows,
    newColumns,
    matched,
    total: rows.length,
    unmatched: unmatchedCodes,
  };
}
