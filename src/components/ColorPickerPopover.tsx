import { useState, useRef, useEffect, useCallback } from 'react';
import { HexColorPicker } from 'react-colorful';

interface ColorPickerPopoverProps {
  color: string;
  onChange: (color: string) => void;
  presetColors: { value: string; label?: string }[] | string[];
}

export function ColorPickerPopover({ color, onChange, presetColors }: ColorPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(color);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const isCustom = !presetColors.some((c) =>
    (typeof c === 'string' ? c : c.value) === color
  );

  useEffect(() => {
    setHexInput(color);
  }, [color]);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (
      popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
      triggerRef.current && !triggerRef.current.contains(e.target as Node)
    ) {
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [open, handleClickOutside]);

  const toggleOpen = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 200;
      let left = rect.left + rect.width / 2 - popoverWidth / 2;
      if (left < 4) left = 4;
      if (left + popoverWidth > window.innerWidth - 4) left = window.innerWidth - popoverWidth - 4;
      setPos({ top: rect.bottom + 6, left });
    }
    setOpen(!open);
  };

  const commitHex = (raw: string) => {
    let v = raw.trim();
    if (!v.startsWith('#')) v = '#' + v;
    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
      onChange(v.toLowerCase());
      setHexInput(v.toLowerCase());
    } else {
      setHexInput(color);
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        className={`color-swatch-custom ${isCustom ? 'color-swatch-active' : ''}`}
        title="Custom color"
        onClick={toggleOpen}
      >
        <div
          className="color-swatch-custom-inner"
          style={{ background: isCustom ? color : undefined }}
        />
      </div>
      {open && pos && (
        <div
          ref={popoverRef}
          className="color-picker-popover"
          style={{ top: pos.top, left: pos.left }}
        >
          <HexColorPicker color={color} onChange={onChange} />
          <div className="color-picker-hex-row">
            <span className="color-picker-hex-label">HEX</span>
            <input
              className="color-picker-hex-input"
              type="text"
              value={hexInput}
              onChange={(e) => {
                setHexInput(e.target.value);
                const v = e.target.value;
                if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v.toLowerCase());
              }}
              onBlur={(e) => commitHex(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitHex((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setOpen(false);
              }}
              spellCheck={false}
            />
          </div>
        </div>
      )}
    </>
  );
}
