/** Legend entry data model */

export type LegendSymbol = 'circle' | 'square' | 'triangle' | 'pin' | 'line';

export interface LegendEntry {
  id: string;
  symbol: LegendSymbol;
  label: string;
  color: string;
  opacity: number;       // 0–1
  strokeColor: string;
  strokeWidth: number;   // 0 = no stroke
  strokeOpacity: number; // 0–1
}

let idCounter = 0;

export function createLegendEntry(partial?: Partial<LegendEntry>): LegendEntry {
  return {
    id: `legend-${++idCounter}-${Date.now()}`,
    symbol: 'circle',
    label: '',
    color: '#3b7dd8',
    opacity: 1,
    strokeColor: '#1a1a1a',
    strokeWidth: 0,
    strokeOpacity: 1,
    ...partial,
  };
}
