import type { LegendEntry, LegendSymbol } from '../legend';
import { createLegendEntry } from '../legend';

interface LegendBuilderProps {
  entries: LegendEntry[];
  setEntries: React.Dispatch<React.SetStateAction<LegendEntry[]>>;
}

const COLORS = [
  '#1a1a1a', '#8c8c8c', '#ffffff',
  '#c0392b', '#3a9a6b', '#3b7dd8',
];

const SYMBOLS: { value: LegendSymbol; label: string }[] = [
  { value: 'circle', label: '●' },
  { value: 'square', label: '■' },
  { value: 'triangle', label: '▲' },
  { value: 'pin', label: '📍' },
  { value: 'line', label: '━' },
];

function SymbolPreview({ entry }: { entry: LegendEntry }) {
  const size = 18;
  const half = size / 2;
  const stroke = entry.strokeWidth > 0 ? entry.strokeColor : 'none';
  const strokeOp = entry.strokeWidth > 0 ? entry.strokeOpacity : 0;
  const sw = entry.strokeWidth;
  const fill = entry.color;
  const op = entry.opacity;

  if (entry.symbol === 'line') {
    return (
      <svg width={size} height={size} style={{ flexShrink: 0 }}>
        <line
          x1={2} y1={half} x2={size - 2} y2={half}
          stroke={fill} strokeWidth={Math.max(sw, 2)} opacity={op}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} style={{ flexShrink: 0 }}>
      {entry.symbol === 'circle' && (
        <circle cx={half} cy={half} r={half - 2}
          fill={fill} fillOpacity={op}
          stroke={stroke} strokeWidth={sw} strokeOpacity={strokeOp}
        />
      )}
      {entry.symbol === 'square' && (
        <rect x={2} y={2} width={size - 4} height={size - 4}
          fill={fill} fillOpacity={op}
          stroke={stroke} strokeWidth={sw} strokeOpacity={strokeOp}
        />
      )}
      {entry.symbol === 'triangle' && (
        <polygon points={`${half},2 ${size - 2},${size - 2} 2,${size - 2}`}
          fill={fill} fillOpacity={op}
          stroke={stroke} strokeWidth={sw} strokeOpacity={strokeOp}
        />
      )}
      {entry.symbol === 'pin' && (
        <g>
          <circle cx={half} cy={7} r={5}
            fill={fill} fillOpacity={op}
            stroke={stroke} strokeWidth={sw} strokeOpacity={strokeOp}
          />
          <polygon points={`${half - 3},10 ${half},${size - 1} ${half + 3},10`}
            fill={fill} fillOpacity={op}
            stroke={stroke} strokeWidth={sw} strokeOpacity={strokeOp}
          />
        </g>
      )}
    </svg>
  );
}

export function LegendBuilder({ entries, setEntries }: LegendBuilderProps) {
  const addEntry = () => {
    setEntries((prev) => [...prev, createLegendEntry()]);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const updateEntry = (id: string, changes: Partial<LegendEntry>) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...changes } : e))
    );
  };

  const moveEntry = (id: string, dir: -1 | 1) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.id === id);
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  return (
    <div className="legend-builder">
      {entries.map((entry, i) => (
        <div key={entry.id} className="legend-entry">
          {/* Top row: symbol preview + label + delete */}
          <div className="legend-entry-header">
            <SymbolPreview entry={entry} />
            <input
              type="text"
              className="legend-label-input"
              placeholder="Label"
              value={entry.label}
              onChange={(e) => updateEntry(entry.id, { label: e.target.value })}
            />
            <div className="legend-entry-actions">
              <button
                className="icon-btn icon-btn-danger"
                onClick={() => removeEntry(entry.id)}
                title="Remove"
              >
                ×
              </button>
              <button
                className="icon-btn"
                onClick={() => moveEntry(entry.id, -1)}
                disabled={i === 0}
                title="Move up"
              >
                ↑
              </button>
              <button
                className="icon-btn"
                onClick={() => moveEntry(entry.id, 1)}
                disabled={i === entries.length - 1}
                title="Move down"
              >
                ↓
              </button>
            </div>
          </div>

          {/* Symbol picker */}
          <div className="legend-entry-row">
            <span className="style-label">Shape</span>
            <div className="marker-shape-picker">
              {SYMBOLS.map((s) => (
                <button
                  key={s.value}
                  className={`marker-shape-btn${entry.symbol === s.value ? ' marker-shape-btn-on' : ''}`}
                  onClick={() => updateEntry(entry.id, { symbol: s.value })}
                  title={s.value}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Color swatches */}
          <div className="legend-entry-row">
            <span className="style-label">Fill</span>
            <div className="color-swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${entry.color === c ? ' color-swatch-active' : ''}`}
                  style={{ background: c, border: c === '#ffffff' ? '2px solid #d1d1d1' : undefined }}
                  onClick={() => updateEntry(entry.id, { color: c })}
                />
              ))}
            </div>
          </div>

          {/* Opacity */}
          <div className="legend-entry-row">
            <span className="style-label">Opacity</span>
            <input
              type="range"
              className="style-slider"
              min={0} max={1} step={0.05}
              value={entry.opacity}
              onChange={(e) => updateEntry(entry.id, { opacity: Number(e.target.value) })}
            />
            <span className="style-value">{Math.round(entry.opacity * 100)}%</span>
          </div>

          {/* Stroke */}
          <div className="legend-entry-row">
            <span className="style-label">Stroke</span>
            <input
              type="range"
              className="style-slider"
              min={0} max={4} step={0.5}
              value={entry.strokeWidth}
              onChange={(e) => updateEntry(entry.id, { strokeWidth: Number(e.target.value) })}
            />
            <span className="style-value">{entry.strokeWidth}px</span>
          </div>

          {entry.strokeWidth > 0 && (
            <>
              <div className="legend-entry-row">
                <span className="style-label">S.Color</span>
                <div className="color-swatches">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      className={`color-swatch${entry.strokeColor === c ? ' color-swatch-active' : ''}`}
                      style={{ background: c, border: c === '#ffffff' ? '2px solid #d1d1d1' : undefined }}
                      onClick={() => updateEntry(entry.id, { strokeColor: c })}
                    />
                  ))}
                </div>
              </div>
              <div className="legend-entry-row">
                <span className="style-label">S.Opac</span>
                <input
                  type="range"
                  className="style-slider"
                  min={0} max={1} step={0.05}
                  value={entry.strokeOpacity}
                  onChange={(e) => updateEntry(entry.id, { strokeOpacity: Number(e.target.value) })}
                />
                <span className="style-value">{Math.round(entry.strokeOpacity * 100)}%</span>
              </div>
            </>
          )}
        </div>
      ))}

      <button className="action-btn" onClick={addEntry} style={{ width: '100%' }}>
        + Add legend entry
      </button>
    </div>
  );
}
