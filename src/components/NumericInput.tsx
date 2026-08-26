import { useState, useEffect } from 'react';

export function NumericInput({ value, min, max, unit, onChange }: {
  value: number; min: number; max: number; unit: string;
  onChange: (v: number) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setLocal(String(value));
  }, [value, focused]);

  const commit = () => {
    const num = Number(local);
    if (isNaN(num) || local.trim() === '' || local.trim() === '-') {
      setLocal(String(value));
    } else {
      const clamped = Math.max(min, Math.min(max, Math.round(num)));
      onChange(clamped);
      setLocal(String(clamped));
    }
  };

  return (
    <div className="style-value-input-wrap">
      <input
        type="text"
        inputMode="numeric"
        className="style-value-input"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      <span className="style-value-unit">{unit}</span>
    </div>
  );
}
