import { useState, useRef } from 'react';
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
  const annotationStoreRef = useRef(new AnnotationStore());
  const shapeStoreRef = useRef(new ShapeStore());
  const markerStoreRef = useRef(new MarkerStore());
  const arrowStoreRef = useRef(new ArrowStore());

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
      />
      <MapView onMapReady={setMap} overlay={overlay} legendEntries={legendEntries} />
    </div>
  );
}

export default App;
