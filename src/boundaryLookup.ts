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
  sampleValues?: string[];
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

// ── geoBoundaries (bundled in public/boundaries/) ────────────────
// ADM0: /boundaries/adm0.geojson (all countries)
// ADM1: /boundaries/adm1/{ISO3}.geojson (per-country)
// Special: /boundaries/adm1/ITA-regions.geojson (Italy regioni = geoBoundaries ADM2)
const GB_JOIN_FIELDS = ['shapeName', 'shapeID', 'shapeISO'];

const WORLD_BOUNDARIES: BoundaryType[] = [
  {
    id: 'world-countries',
    name: 'World Countries',
    description: 'Country boundaries (geoBoundaries)',
    group: 'world',
    columnPatterns: [
      /^(country|country[_\s-]?(name|code)|nation|iso[_\s-]?a[23]?|iso[_\s-]?code|country[_\s-]?iso)$/i,
    ],
    fetchUrl: '/boundaries/adm0.geojson',
    joinFields: [...GB_JOIN_FIELDS, 'shapeGroup'],
  },
  {
    id: 'us-states',
    name: 'US States',
    description: 'US state boundaries',
    group: 'us',
    columnPatterns: [
      /^(state|state[_\s-]?(name|code|abbr)|us[_\s-]?state|stusab|stusps)$/i,
    ],
    fetchUrl: '/boundaries/adm1/USA.geojson',
    joinFields: GB_JOIN_FIELDS,
    sampleValues: ['california', 'texas', 'new york', 'florida', 'illinois', 'pennsylvania', 'ohio', 'georgia', 'michigan', 'north carolina'],
  },
];

// ── Per-country admin1 entries ───────────────────────────────────
interface CountryAdmin1 {
  id: string;
  name: string;
  description: string;
  iso3: string;
  file?: string; // override filename if not {iso3}.geojson
  columnPatterns: RegExp[];
  sampleValues?: string[];
}

const COUNTRY_ADMIN1: CountryAdmin1[] = [
  { id: 'gb-regions', name: 'UK Regions', description: 'Nations & counties', iso3: 'GBR',
    columnPatterns: [/^(region|county|constituency|local[_\s-]?authority|council|borough|district)$/i],
    sampleValues: ['england', 'scotland', 'wales', 'northern ireland', 'london', 'greater manchester', 'west midlands', 'kent', 'essex', 'surrey'] },
  { id: 'de-states', name: 'Germany States', description: 'Bundesländer', iso3: 'DEU',
    columnPatterns: [/^(bundesland|land|state|region|kreis)$/i],
    sampleValues: ['bayern', 'bavaria', 'nordrhein-westfalen', 'baden-württemberg', 'hessen', 'sachsen', 'berlin', 'hamburg', 'niedersachsen'] },
  { id: 'fr-regions', name: 'France Regions', description: 'Régions', iso3: 'FRA',
    columnPatterns: [/^(d[ée]partement|r[ée]gion|department|region)$/i],
    sampleValues: ['île-de-france', 'auvergne-rhône-alpes', 'normandie', 'bretagne', 'occitanie', 'nouvelle-aquitaine', 'bourgogne-franche-comté'] },
  { id: 'es-regions', name: 'Spain Regions', description: 'Comunidades autónomas', iso3: 'ESP',
    columnPatterns: [/^(comunidad|provincia|autonomous[_\s-]?community|region)$/i],
    sampleValues: ['cataluña', 'andalucía', 'madrid', 'valencia', 'galicia', 'castilla y león', 'país vasco', 'canarias'] },
  { id: 'br-states', name: 'Brazil States', description: 'Estados', iso3: 'BRA',
    columnPatterns: [/^(estado|state|uf|sigla[_\s-]?uf|region)$/i],
    sampleValues: ['são paulo', 'rio de janeiro', 'minas gerais', 'bahia', 'paraná', 'rio grande do sul', 'pernambuco', 'roraima'] },
  { id: 'it-regions', name: 'Italy Regions', description: 'Regioni', iso3: 'ITA', file: 'ITA-regions',
    columnPatterns: [/^(provincia|province|regione|region)$/i],
    sampleValues: ['lombardia', 'lazio', 'campania', 'veneto', 'sicilia', 'emilia-romagna', 'piemonte', 'puglia', 'toscana', 'calabria', 'sardegna', 'liguria'] },
  { id: 'in-states', name: 'India States', description: 'States & union territories', iso3: 'IND',
    columnPatterns: [/^(state|state[_\s-]?name|ut|union[_\s-]?territory|pradesh|region)$/i],
    sampleValues: ['maharashtra', 'uttar pradesh', 'karnataka', 'tamil nadu', 'kerala', 'rajasthan', 'gujarat', 'west bengal'] },
  { id: 'jp-prefectures', name: 'Japan Prefectures', description: '都道府県', iso3: 'JPN',
    columnPatterns: [/^(prefecture|ken|to|fu|do|todofuken|都道府県)$/i],
    sampleValues: ['tokyo', 'osaka', 'hokkaido', 'kyoto', 'kanagawa', 'aichi', 'fukuoka', 'hyogo'] },
  { id: 'ph-provinces', name: 'Philippines Provinces', description: 'Provinces', iso3: 'PHL',
    columnPatterns: [/^(province|lalawigan)$/i],
    sampleValues: ['cebu', 'cavite', 'bulacan', 'laguna', 'pangasinan', 'batangas', 'rizal', 'nueva ecija'] },
  { id: 'au-states', name: 'Australia States', description: 'States & territories', iso3: 'AUS',
    columnPatterns: [/^(state|territory|state[_\s-]?territory)$/i],
    sampleValues: ['new south wales', 'victoria', 'queensland', 'western australia', 'south australia', 'tasmania'] },
  { id: 'nz-regions', name: 'New Zealand Regions', description: 'Regional councils', iso3: 'NZL',
    columnPatterns: [/^(region|regional[_\s-]?council)$/i],
    sampleValues: ['auckland', 'canterbury', 'wellington', 'waikato', 'bay of plenty', 'otago'] },
  { id: 'za-provinces', name: 'South Africa Provinces', description: 'Provinces', iso3: 'ZAF',
    columnPatterns: [/^(province|provinsie|region)$/i],
    sampleValues: ['gauteng', 'kwazulu-natal', 'western cape', 'eastern cape', 'limpopo', 'mpumalanga'] },
  { id: 'ke-counties', name: 'Kenya Counties', description: 'Counties', iso3: 'KEN',
    columnPatterns: [/^(county|kaunti)$/i],
    sampleValues: ['nairobi', 'mombasa', 'kiambu', 'nakuru', 'machakos', 'kajiado', 'kisumu'] },
];

function countryAdmin1ToBoundary(ca: CountryAdmin1): BoundaryType {
  const filename = ca.file || ca.iso3;
  return {
    id: ca.id,
    name: ca.name,
    description: ca.description,
    group: 'world',
    columnPatterns: ca.columnPatterns,
    fetchUrl: `/boundaries/adm1/${filename}.geojson`,
    joinFields: GB_JOIN_FIELDS,
    sampleValues: ca.sampleValues,
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
  const candidates: { type: BoundaryType; column: string; score: number }[] = [];

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

      let score = 0;
      if (bt.sampleValues && rows.length > 0) {
        const dataValues = rows.slice(0, 20).map(r => normalize(r[col] ?? '')).filter(Boolean);
        const sampleSet = new Set(bt.sampleValues.map(v => normalize(v)));
        for (const v of dataValues) {
          if (sampleSet.has(v)) score++;
        }
      }

      candidates.push({ type: bt, column: col, score });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return { type: candidates[0].type, column: candidates[0].column };
}

export async function fetchBoundaryGeoJSON(
  url: string,
  onProgress?: (msg: string) => void,
): Promise<GeoJSON.FeatureCollection> {
  if (boundaryCache.has(url)) return boundaryCache.get(url)!;

  onProgress?.('Fetching boundaries...');
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to fetch boundaries (${res.status})`);
  onProgress?.('Parsing...');
  const fc = await res.json() as GeoJSON.FeatureCollection;

  boundaryCache.set(url, fc);
  return fc;
}

export function findJoinField(
  geojson: GeoJSON.FeatureCollection,
  candidates: string[],
  csvValues?: string[],
): string | null {
  if (geojson.features.length === 0) return null;
  const props = geojson.features[0].properties ?? {};
  const keys = Object.keys(props);
  const keysLower = keys.map(k => k.toLowerCase());

  const validFields: string[] = [];
  for (const c of candidates) {
    const idx = keysLower.indexOf(c.toLowerCase());
    if (idx !== -1) validFields.push(keys[idx]);
  }
  if (validFields.length === 0) return null;
  if (validFields.length === 1 || !csvValues || csvValues.length === 0) return validFields[0];

  const normalizedCSV = csvValues.map(v => normalize(v));
  let bestField = validFields[0];
  let bestScore = -1;
  for (const field of validFields) {
    const geoValues = new Set(
      geojson.features.map(f => normalize(String(f.properties?.[field] ?? '')))
    );
    let score = 0;
    for (const v of normalizedCSV) {
      if (geoValues.has(v) || (NAME_ALIASES[v] && geoValues.has(NAME_ALIASES[v]))) score++;
    }
    if (score > bestScore) { bestScore = score; bestField = field; }
  }
  return bestField;
}

export function getFieldNames(geojson: GeoJSON.FeatureCollection): string[] {
  if (geojson.features.length === 0) return [];
  return Object.keys(geojson.features[0].properties ?? {});
}

function computeCentroid(geometry: GeoJSON.Geometry): [number, number] | null {
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

const NAME_ALIASES: Record<string, string> = {
  'sicilia': 'sicily', 'sicily': 'sicilia',
  'puglia': 'apulia', 'apulia': 'puglia',
  'sardinia': 'sardegna', 'sardegna': 'sardinia',
  'tuscany': 'toscana', 'toscana': 'tuscany',
  'piedmont': 'piemonte', 'piemonte': 'piedmont',
  'lombardy': 'lombardia', 'lombardia': 'lombardy',
  'bavaria': 'bayern', 'bayern': 'bavaria',
  'north rhine-westphalia': 'nordrhein-westfalen',
  'lower saxony': 'niedersachsen',
  'brittany': 'bretagne', 'bretagne': 'brittany',
  'corsica': 'corse', 'corse': 'corsica',
};

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
    let centroid = centroidMap.get(code);
    if (!centroid && code) {
      const alias = NAME_ALIASES[code];
      if (alias) centroid = centroidMap.get(alias);
    }
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
