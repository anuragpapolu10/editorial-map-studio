import type { DataRow } from './dataStore';

export interface ChoroplethBoundary {
  name: string;
  nameEn: string;
  osmId: number;
  geometry: GeoJSON.Geometry;
  matchedRow: number | null;
  matchScore: number;
}

export interface MatchReport {
  matched: number;
  total: number;
  unmatched: string[];
}

export const ADMIN_LEVELS: Record<string, { states: number; counties: number; cities: number }> = {
  US: { states: 4, counties: 6, cities: 8 },
  GB: { states: 4, counties: 6, cities: 8 },
  CA: { states: 4, counties: 6, cities: 8 },
  AU: { states: 4, counties: 5, cities: 7 },
  DE: { states: 4, counties: 6, cities: 8 },
  FR: { states: 4, counties: 6, cities: 8 },
  IN: { states: 4, counties: 5, cities: 8 },
  BR: { states: 4, counties: 6, cities: 8 },
  MX: { states: 4, counties: 6, cities: 8 },
  IT: { states: 4, counties: 6, cities: 8 },
  ES: { states: 4, counties: 6, cities: 8 },
  JP: { states: 4, counties: 6, cities: 8 },
  CN: { states: 4, counties: 6, cities: 8 },
  _default: { states: 4, counties: 6, cities: 8 },
};

export type RegionType = 'states' | 'counties' | 'cities';

export function getAdminLevel(countryCode: string, regionType: RegionType): number {
  const entry = ADMIN_LEVELS[countryCode.toUpperCase()] ?? ADMIN_LEVELS._default;
  return entry[regionType];
}

const US_STATE_ABBREVS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  DC: 'District of Columbia', PR: 'Puerto Rico',
};

export function normalizeRegionName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''ʻ]/g, "'")
    .replace(/[-_]/g, ' ')
    .replace(/\b(state|province|county|district|region|department|prefecture|of)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function expandAbbreviation(name: string, countryCode: string): string | null {
  if (countryCode.toUpperCase() === 'US') {
    const upper = name.toUpperCase().replace(/\./g, '');
    if (US_STATE_ABBREVS[upper]) return US_STATE_ABBREVS[upper];
  }
  return null;
}

export function matchRegions(
  csvNames: string[],
  boundaries: ChoroplethBoundary[],
  countryCode: string,
): { boundaries: ChoroplethBoundary[]; report: MatchReport } {
  const result = boundaries.map(b => ({ ...b, matchedRow: null as number | null, matchScore: 0 }));
  const matched = new Set<number>();
  const boundaryUsed = new Set<number>();

  const normBoundaries = result.map(b => ({
    norm: normalizeRegionName(b.name),
    normEn: b.nameEn ? normalizeRegionName(b.nameEn) : '',
  }));

  // Pass 1: exact match after normalization
  for (let i = 0; i < csvNames.length; i++) {
    if (matched.has(i)) continue;
    const expanded = expandAbbreviation(csvNames[i], countryCode);
    const normCsv = normalizeRegionName(expanded || csvNames[i]);
    for (let j = 0; j < result.length; j++) {
      if (boundaryUsed.has(j)) continue;
      if (normCsv === normBoundaries[j].norm || normCsv === normBoundaries[j].normEn) {
        result[j].matchedRow = i;
        result[j].matchScore = 1.0;
        matched.add(i);
        boundaryUsed.add(j);
        break;
      }
    }
  }

  // Pass 2: fuzzy match with Levenshtein
  for (let i = 0; i < csvNames.length; i++) {
    if (matched.has(i)) continue;
    const expanded = expandAbbreviation(csvNames[i], countryCode);
    const normCsv = normalizeRegionName(expanded || csvNames[i]);
    let bestJ = -1;
    let bestDist = Infinity;
    for (let j = 0; j < result.length; j++) {
      if (boundaryUsed.has(j)) continue;
      const d1 = levenshtein(normCsv, normBoundaries[j].norm);
      const d2 = normBoundaries[j].normEn ? levenshtein(normCsv, normBoundaries[j].normEn) : Infinity;
      const d = Math.min(d1, d2);
      if (d < bestDist) { bestDist = d; bestJ = j; }
    }
    const threshold = Math.max(2, normCsv.length * 0.3);
    if (bestJ >= 0 && bestDist <= threshold) {
      result[bestJ].matchedRow = i;
      result[bestJ].matchScore = Math.max(0, 1 - bestDist / normCsv.length);
      matched.add(i);
      boundaryUsed.add(bestJ);
    }
  }

  const unmatched = csvNames.filter((_, i) => !matched.has(i));
  return {
    boundaries: result,
    report: { matched: matched.size, total: csvNames.length, unmatched },
  };
}

// --- Overpass API ---

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export async function fetchBoundaries(
  countryCode: string,
  adminLevel: number,
  onProgress: (msg: string) => void,
): Promise<ChoroplethBoundary[]> {
  onProgress('Querying boundaries...');
  const query = `
[out:json][timeout:120];
area["ISO3166-1"="${countryCode.toUpperCase()}"]->.country;
rel["admin_level"="${adminLevel}"]["boundary"="administrative"](area.country);
out geom;
`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);
  const data = await res.json();
  onProgress('Assembling polygons...');
  return assemblePolygons(data.elements || []);
}

function assemblePolygons(elements: any[]): ChoroplethBoundary[] {
  const relations = elements.filter((e: any) => e.type === 'relation');
  return relations.map((rel: any) => {
    const name = rel.tags?.name || `OSM ${rel.id}`;
    const nameEn = rel.tags?.['name:en'] || '';
    const outerWays: number[][][] = [];
    const innerWays: number[][][] = [];

    for (const member of rel.members || []) {
      if (member.type !== 'way' || !member.geometry) continue;
      const coords = member.geometry.map((pt: any) => [pt.lon, pt.lat]);
      if (member.role === 'inner') {
        innerWays.push(coords);
      } else {
        outerWays.push(coords);
      }
    }

    const outerRings = assembleRings(outerWays);
    const innerRings = assembleRings(innerWays);

    let geometry: GeoJSON.Geometry;
    if (outerRings.length === 0) {
      geometry = { type: 'Polygon', coordinates: [[]] };
    } else if (outerRings.length === 1) {
      const coords: number[][][] = [outerRings[0]];
      for (const inner of innerRings) coords.push(inner);
      geometry = { type: 'Polygon', coordinates: coords };
    } else {
      const polys: number[][][][] = outerRings.map(ring => {
        const poly: number[][][] = [ring];
        return poly;
      });
      // assign inner rings to the outer ring that contains them
      for (const inner of innerRings) {
        const pt = inner[0];
        for (const poly of polys) {
          if (pointInRing(pt, poly[0])) {
            poly.push(inner);
            break;
          }
        }
      }
      geometry = { type: 'MultiPolygon', coordinates: polys };
    }

    return { name, nameEn, osmId: rel.id, geometry, matchedRow: null, matchScore: 0 };
  });
}

function assembleRings(ways: number[][][]): number[][] [] {
  if (ways.length === 0) return [];
  const rings: number[][][] = [];
  const used = new Set<number>();

  while (used.size < ways.length) {
    let startIdx = -1;
    for (let i = 0; i < ways.length; i++) {
      if (!used.has(i)) { startIdx = i; break; }
    }
    if (startIdx < 0) break;

    const ring = [...ways[startIdx]];
    used.add(startIdx);

    let maxIter = ways.length * 2;
    while (!ringClosed(ring) && maxIter-- > 0) {
      const end = ring[ring.length - 1];
      let found = false;
      for (let i = 0; i < ways.length; i++) {
        if (used.has(i)) continue;
        const way = ways[i];
        if (coordsClose(end, way[0])) {
          ring.push(...way.slice(1));
          used.add(i);
          found = true;
          break;
        }
        if (coordsClose(end, way[way.length - 1])) {
          ring.push(...[...way].reverse().slice(1));
          used.add(i);
          found = true;
          break;
        }
      }
      if (!found) break;
    }

    if (!ringClosed(ring) && ring.length > 0) {
      ring.push(ring[0]);
    }
    rings.push(ring);
  }

  return rings;
}

function ringClosed(ring: number[][]): boolean {
  if (ring.length < 4) return false;
  return coordsClose(ring[0], ring[ring.length - 1]);
}

function coordsClose(a: number[], b: number[]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function pointInRing(pt: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// --- Color Ramps ---

export const SEQUENTIAL_RAMPS: Record<string, string[]> = {
  blues:   ['#deebf7', '#9ecae1', '#4292c6', '#2171b5', '#084594'],
  reds:    ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15'],
  greens:  ['#edf8e9', '#bae4b3', '#74c476', '#31a354', '#006d2c'],
  purples: ['#f2f0f7', '#b4b3d8', '#8888c6', '#6a51a3', '#3f007d'],
  oranges: ['#feedde', '#fdbe85', '#fd8d3c', '#e6550d', '#a63603'],
};

export const DIVERGING_RAMPS: Record<string, string[]> = {
  rdylgn:   ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#1a9850'],
  rdbu:     ['#ca0020', '#f4a582', '#f7f7f7', '#92c5de', '#0571b0'],
  spectral: ['#d53e4f', '#fc8d59', '#fee08b', '#99d594', '#3288bd'],
  piyg:     ['#c51b7d', '#e9a3c9', '#f7f7f7', '#a1d76a', '#4d9221'],
};

export function buildFillColorExpression(
  ramp: string[],
  min: number,
  max: number,
  missingColor: string,
): any[] {
  const range = max - min || 1;
  return [
    'case',
    ['==', ['get', 'value'], null], missingColor,
    ['!', ['get', '_matched']], missingColor,
    ['interpolate', ['linear'], ['get', 'value'],
      min, ramp[0],
      min + range * 0.25, ramp[1],
      min + range * 0.5, ramp[2],
      min + range * 0.75, ramp[3],
      max, ramp[4],
    ],
  ];
}

// --- GeoJSON for MapLibre ---

export function buildChoroplethGeoJSON(
  boundaries: ChoroplethBoundary[],
  rows: DataRow[],
  valueCol: string | null,
  regionCol: string | null,
  commas: boolean,
  prefix: string,
  suffix: string,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: boundaries
      .filter(b => b.geometry.type !== 'Polygon' || (b.geometry as any).coordinates[0].length > 0)
      .map(b => {
        const row = b.matchedRow !== null ? rows[b.matchedRow] : null;
        const rawVal = row && valueCol ? parseFloat(row[valueCol]) : null;
        const value = rawVal !== null && !isNaN(rawVal) ? rawVal : null;
        let formattedValue = '';
        if (value !== null) {
          formattedValue = prefix + (commas ? value.toLocaleString('en-US') : String(value)) + suffix;
        }
        const label = row && regionCol ? (row[regionCol] ?? b.name) : b.name;
        return {
          type: 'Feature' as const,
          geometry: b.geometry,
          properties: {
            _matched: b.matchedRow !== null,
            _regionName: b.name,
            value,
            formattedValue,
            label,
          },
        };
      }),
  };
}

export function getChoroplethValueRange(
  boundaries: ChoroplethBoundary[],
  rows: DataRow[],
  valueCol: string | null,
): { min: number; max: number } {
  if (!valueCol) return { min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (const b of boundaries) {
    if (b.matchedRow === null) continue;
    const v = parseFloat(rows[b.matchedRow][valueCol]);
    if (isNaN(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}
