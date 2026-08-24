export interface DataRow {
  [key: string]: string;
}

export interface DataState {
  raw: string;
  rows: DataRow[];
  columns: string[];
  latCol: string | null;
  lngCol: string | null;
  valueCol: string | null;
  labelCol: string | null;
  vizType: 'points' | 'bubbles' | 'heatmap' | 'spikes' | 'choropleth';
  pointColor: string;
  pointRadius: number;
  maxRadius: number;
  opacity: number;
  locked: boolean;
  showLabels: boolean;
  showValues: boolean;
  labelSize: number;
  labelAnchors: Record<number, number>;
  formatCommas: boolean;
  valuePrefix: string;
  valueSuffix: string;
  heatmapRadius: number;
  heatmapIntensity: number;
  heatmapColorRamp: 'inferno' | 'magma' | 'plasma' | 'viridis';
  heatmapLegendTitle: string;
  spikeStyle: 'pointed' | 'bar';
  spikeHeight: number;
  spikeWidth: number;
  spikeColor: string;
  spikeShowValues: boolean;
  spikeCommas: boolean;
  spikeSuffix: string;
  spikeShowLabels: boolean;
  spikeLabelSize: number;
  choroplethRegionCol: string | null;
  choroplethCountryCode: string;
  choroplethRegionType: 'states' | 'counties' | 'cities';
  choroplethColorScale: 'sequential' | 'diverging';
  choroplethColorRamp: string;
  choroplethStrokeColor: string;
  choroplethStrokeWidth: number;
  choroplethShowLabels: boolean;
  choroplethShowValues: boolean;
  choroplethLegendTitle: string;
  choroplethMissingColor: string;
  choroplethCommas: boolean;
  choroplethPrefix: string;
  choroplethSuffix: string;
}

export interface HeatmapLegendInfo {
  visible: boolean;
  title: string;
  ramp: 'inferno' | 'magma' | 'plasma' | 'viridis';
  min: number;
  max: number;
}

export const DEFAULT_DATA_STATE: DataState = {
  raw: '',
  rows: [],
  columns: [],
  latCol: null,
  lngCol: null,
  valueCol: null,
  labelCol: null,
  vizType: 'points',
  pointColor: '#e63946',
  pointRadius: 6,
  maxRadius: 30,
  opacity: 0.85,
  locked: false,
  showLabels: false,
  showValues: false,
  labelSize: 11,
  labelAnchors: {},
  formatCommas: false,
  valuePrefix: '',
  valueSuffix: '',
  heatmapRadius: 20,
  heatmapIntensity: 2,
  heatmapColorRamp: 'inferno',
  heatmapLegendTitle: '',
  spikeStyle: 'pointed',
  spikeHeight: 120,
  spikeWidth: 6,
  spikeColor: '#e63946',
  spikeShowValues: false,
  spikeCommas: false,
  spikeSuffix: '',
  spikeShowLabels: false,
  spikeLabelSize: 11,
  choroplethRegionCol: null,
  choroplethCountryCode: '',
  choroplethRegionType: 'states',
  choroplethColorScale: 'sequential',
  choroplethColorRamp: 'blues',
  choroplethStrokeColor: '#333333',
  choroplethStrokeWidth: 1,
  choroplethShowLabels: false,
  choroplethShowValues: false,
  choroplethLegendTitle: '',
  choroplethMissingColor: '#e0e0e0',
  choroplethCommas: false,
  choroplethPrefix: '',
  choroplethSuffix: '',
};

const LAT_NAMES = ['lat', 'latitude', 'y'];
const LNG_NAMES = ['lng', 'lon', 'longitude', 'long', 'x'];
const VALUE_NAMES = ['value', 'val', 'count', 'population', 'pop', 'amount', 'total', 'number', 'num', 'rate', 'pct', 'percent', 'percentage'];
const LABEL_NAMES = ['name', 'label', 'title', 'city', 'place', 'location', 'country', 'state', 'county'];

function autoDetect(columns: string[], candidates: string[]): string | null {
  const lower = columns.map(c => c.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return columns[idx];
  }
  return null;
}

export function parseCSV(text: string): { rows: DataRow[]; columns: string[] } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { rows: [], columns: [] };

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const columns = parseLine(lines[0], delimiter);
  const rows: DataRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseLine(line, delimiter);
    const row: DataRow = {};
    columns.forEach((col, j) => {
      row[col] = values[j] ?? '';
    });
    rows.push(row);
  }

  return { rows, columns };
}

function parseLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function autoDetectColumns(columns: string[]): Pick<DataState, 'latCol' | 'lngCol' | 'valueCol' | 'labelCol'> {
  return {
    latCol: autoDetect(columns, LAT_NAMES),
    lngCol: autoDetect(columns, LNG_NAMES),
    valueCol: autoDetect(columns, VALUE_NAMES),
    labelCol: autoDetect(columns, LABEL_NAMES),
  };
}

export interface ValidPoint {
  lat: number;
  lng: number;
  value: number | null;
  label: string;
  row: DataRow;
}

export interface SkippedRow {
  rowIndex: number;
  name: string;
  reason: string;
}

export function extractPoints(state: DataState): ValidPoint[] {
  if (!state.latCol || !state.lngCol) return [];
  const points: ValidPoint[] = [];
  for (const row of state.rows) {
    const lat = parseFloat(row[state.latCol]);
    const lng = parseFloat(row[state.lngCol]);
    if (isNaN(lat) || isNaN(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const rawVal = state.valueCol ? parseFloat(row[state.valueCol]) : null;
    const value = rawVal !== null && !isNaN(rawVal) ? rawVal : null;
    const label = state.labelCol ? row[state.labelCol] ?? '' : '';
    points.push({ lat, lng, value, label, row });
  }
  return points;
}

export function getSkippedRows(state: DataState): SkippedRow[] {
  if (!state.latCol || !state.lngCol) return [];
  const skipped: SkippedRow[] = [];
  const nameCol = state.labelCol || state.columns[0];
  for (let i = 0; i < state.rows.length; i++) {
    const row = state.rows[i];
    const lat = parseFloat(row[state.latCol]);
    const lng = parseFloat(row[state.lngCol]);
    const name = nameCol ? row[nameCol] ?? `Row ${i + 2}` : `Row ${i + 2}`;
    if (isNaN(lat) || isNaN(lng)) {
      skipped.push({ rowIndex: i, name, reason: 'invalid coordinates' });
    } else if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      skipped.push({ rowIndex: i, name, reason: 'coordinates out of range' });
    }
  }
  return skipped;
}

export function getValueRange(points: ValidPoint[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.value !== null) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
  }
  if (!isFinite(min)) return { min: 0, max: 1 };
  if (min === max) return { min, max: min + 1 };
  return { min, max };
}

export const ANCHOR_POSITIONS = ['top', 'right', 'bottom', 'left'] as const;

function formatWithCommas(n: number): string {
  return n.toLocaleString('en-US');
}

export function pointsToGeoJSON(points: ValidPoint[], anchors: Record<number, number> = {}, commas = false, prefix = '', suffix = ''): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p, i) => {
      let fv = '';
      if (p.value !== null) {
        fv = prefix + (commas ? formatWithCommas(p.value) : String(p.value)) + suffix;
      }
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
        properties: {
          value: p.value,
          formattedValue: fv,
          label: p.label,
          _idx: i,
          _anchor: ANCHOR_POSITIONS[anchors[i] ?? 0],
        },
      };
    }),
  };
}

export interface GeocodeResult {
  rowIndex: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

async function geocodeOne(query: string, regionBias: string): Promise<{ lat: number; lng: number } | null> {
  const fullQuery = regionBias ? `${query}, ${regionBias}` : query;
  const params = new URLSearchParams({ q: fullQuery, format: 'json', limit: '1' });
  try {
    const res = await fetch(`${NOMINATIM_URL}?${params}`, {
      headers: { 'User-Agent': 'EditorialMapStudio/1.0' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function geocodeLocations(
  rows: DataRow[],
  locationCol: string,
  onProgress: (done: number, total: number) => void,
  regionBias = '',
  contextCol?: string,
): Promise<GeocodeResult[]> {
  const unique = new Map<string, { lat: number; lng: number } | null>();
  const queries = rows.map(r => {
    const loc = (r[locationCol] ?? '').trim();
    const ctx = contextCol ? (r[contextCol] ?? '').trim() : '';
    return ctx && loc ? `${loc}, ${ctx}` : loc;
  });
  const names = rows.map(r => (r[locationCol] ?? '').trim());

  for (const query of queries) {
    if (query && !unique.has(query)) unique.set(query, null);
  }

  let done = 0;
  const total = unique.size;

  for (const query of unique.keys()) {
    const result = await geocodeOne(query, regionBias);
    unique.set(query, result);
    done++;
    onProgress(done, total);
    if (done < total) await delay(1100);
  }

  return rows.map((_row, i) => {
    const query = queries[i];
    const coords = query ? unique.get(query) ?? null : null;
    return {
      rowIndex: i,
      name: names[i] || `Row ${i + 2}`,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
  });
}

const SAMPLE_CSV = `City,Lat,Lon,Population
New York,40.7128,-74.006,8336817
Los Angeles,34.0522,-118.2437,3979576
Chicago,41.8781,-87.6298,2693976
Houston,29.7604,-95.3698,2320268
Phoenix,33.4484,-112.074,1680992
Philadelphia,39.9526,-75.1652,1584064
San Antonio,29.4241,-98.4936,1547253
San Diego,32.7157,-117.1611,1423851
Dallas,32.7767,-96.797,1343573
San Jose,37.3382,-121.8863,1021795`;

export function getSampleCSV(): string {
  return SAMPLE_CSV;
}
