import { useState, useRef, useEffect, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { MapView } from './components/MapView';
import { Sidebar } from './components/Sidebar';
import { AnnotationStore } from './annotations';
import { ShapeStore } from './shapes';
import { MarkerStore } from './markers';
import { ArrowStore } from './arrows';
import type { ScaleUnit } from './scalebar';
import type { LegendEntry } from './legend';
import './App.css';

export type AspectRatio = null | '3:2' | '1:1' | '3:4' | '9:16';

export const RATIO_VALUES: Record<string, number> = {
  '3:2': 3 / 2,
  '1:1': 1,
  '3:4': 3 / 4,
  '9:16': 9 / 16,
};

export interface OverlaySettings {
  title: string;
  subtitle: string;
  titleSize: number;    // px
  subtitleSize: number;  // px
  align: 'left' | 'center';
  showScaleBar: boolean;
  scaleUnit: ScaleUnit;
}

export const DEFAULT_OVERLAY: OverlaySettings = {
  title: '',
  subtitle: '',
  titleSize: 38,
  subtitleSize: 22,
  align: 'left',
  showScaleBar: false,
  scaleUnit: 'metric',
};

function App() {
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const [overlay, setOverlay] = useState<OverlaySettings>(DEFAULT_OVERLAY);
  const [legendEntries, setLegendEntries] = useState<LegendEntry[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(null);
  const annotationStoreRef = useRef(new AnnotationStore());
  const shapeStoreRef = useRef(new ShapeStore());
  const markerStoreRef = useRef(new MarkerStore());
  const arrowStoreRef = useRef(new ArrowStore());

  // Letterbox bars — map stays full size, overlay bars create the crop effect
  const areaRef = useRef<HTMLDivElement>(null);
  const [bars, setBars] = useState<{ top: number; bottom: number; left: number; right: number } | null>(null);

  const computeBars = useCallback(() => {
    if (!aspectRatio) { setBars(null); return; }
    const area = areaRef.current;
    if (!area) return;
    const ratio = RATIO_VALUES[aspectRatio];
    const cw = area.clientWidth;
    const ch = area.clientHeight;
    let w = cw;
    let h = cw / ratio;
    if (h > ch) { h = ch; w = ch * ratio; }
    setBars({
      top: Math.max(0, (ch - h) / 2),
      bottom: Math.max(0, (ch - h) / 2),
      left: Math.max(0, (cw - w) / 2),
      right: Math.max(0, (cw - w) / 2),
    });
  }, [aspectRatio]);

  useEffect(() => {
    computeBars();
    const area = areaRef.current;
    if (!area) return;
    const observer = new ResizeObserver(computeBars);
    observer.observe(area);
    return () => observer.disconnect();
  }, [computeBars]);

  return (
    <div className="app">
      <Sidebar
        map={map}
        annotationStore={annotationStoreRef.current}
        shapeStore={shapeStoreRef.current}
        markerStore={markerStoreRef.current}
        arrowStore={arrowStoreRef.current}
        overlay={overlay}
        setOverlay={setOverlay}
        legendEntries={legendEntries}
        setLegendEntries={setLegendEntries}
        aspectRatio={aspectRatio}
        setAspectRatio={setAspectRatio}
      />
      <div
        ref={areaRef}
        className="map-area"
        style={bars ? {
          '--bar-top': `${bars.top}px`,
          '--bar-bottom': `${bars.bottom}px`,
          '--bar-left': `${bars.left}px`,
          '--bar-right': `${bars.right}px`,
        } as React.CSSProperties : {
          '--bar-top': '0px',
          '--bar-bottom': '0px',
          '--bar-left': '0px',
          '--bar-right': '0px',
        } as React.CSSProperties}
      >
        <MapView onMapReady={setMap} overlay={overlay} legendEntries={legendEntries} />
        {bars && (
          <>
            {bars.top > 0 && <div className="letterbox-bar" style={{ top: 0, left: 0, right: 0, height: bars.top }} />}
            {bars.bottom > 0 && <div className="letterbox-bar" style={{ bottom: 0, left: 0, right: 0, height: bars.bottom }} />}
            {bars.left > 0 && <div className="letterbox-bar" style={{ top: bars.top, bottom: bars.bottom, left: 0, width: bars.left }} />}
            {bars.right > 0 && <div className="letterbox-bar" style={{ top: bars.top, bottom: bars.bottom, right: 0, width: bars.right }} />}
          </>
        )}
      </div>
    </div>
  );
}

export default App;
