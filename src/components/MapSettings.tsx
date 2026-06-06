import { useState } from 'react';
import type maplibregl from 'maplibre-gl';

interface MapSettingsProps {
  map: maplibregl.Map | null;
}

type Projection = 'mercator' | 'globe';

export function MapSettings({ map }: MapSettingsProps) {
  const [projection, setProjection] = useState<Projection>('mercator');
  const [pitch, setPitch] = useState(0);

  const changeProjection = (proj: Projection) => {
    if (!map) return;
    setProjection(proj);

    if (proj === 'globe') {
      map.setProjection({ type: 'globe' });
      // Tilt camera for perspective look
      map.easeTo({ pitch: 45, duration: 600 });
      setPitch(45);
    } else {
      map.setProjection({ type: 'mercator' });
      map.easeTo({ pitch: 0, duration: 600 });
      setPitch(0);
    }
  };

  const changePitch = (value: number) => {
    if (!map) return;
    setPitch(value);
    map.setPitch(value);
  };

  return (
    <div className="map-settings">
      {/* Projection toggle */}
      <div className="style-row" style={{ marginBottom: 8 }}>
        <span className="style-label">View</span>
        <div className="font-toggle">
          <button
            className={`font-btn${projection === 'mercator' ? ' font-btn-on' : ''}`}
            onClick={() => changeProjection('mercator')}
          >
            Flat
          </button>
          <button
            className={`font-btn${projection === 'globe' ? ' font-btn-on' : ''}`}
            onClick={() => changeProjection('globe')}
          >
            Globe
          </button>
        </div>
      </div>

      {/* Pitch slider — always available but especially useful for globe */}
      <div className="style-row">
        <span className="style-label">Tilt</span>
        <input
          type="range"
          className="style-slider"
          min={0}
          max={85}
          value={pitch}
          onChange={(e) => changePitch(Number(e.target.value))}
        />
        <div className="style-value-input-wrap">
          <input
            type="number"
            className="style-value-input"
            min={0}
            max={85}
            value={pitch}
            onChange={(e) => changePitch(Number(e.target.value))}
          />
          <span className="style-value-unit">°</span>
        </div>
      </div>
    </div>
  );
}
