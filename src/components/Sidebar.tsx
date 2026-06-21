import { useState } from 'react';
import maplibregl from 'maplibre-gl';
import { LayerToggles } from './LayerToggles';
import { SearchBar } from './SearchBar';
import { DrawingTools } from './DrawingTools';
import { ShapeTools } from './ShapeTools';
import { MarkerTools } from './MarkerTools';
import { ArrowTools } from './ArrowTools';
import { ExportTools } from './ExportTools';
import { LegendBuilder } from './LegendBuilder';
import { DataTools } from './DataTools';
import { AnnotationStore } from '../annotations';
import { ShapeStore } from '../shapes';
import { MarkerStore } from '../markers';
import { ArrowStore } from '../arrows';
import type { OverlaySettings, AspectRatio } from '../App';
import type { LegendEntry } from '../legend';

export type ActiveTool = null | 'text' | 'marker' | 'arrow' | 'rectangle' | 'ellipse' | 'line';

type SidebarTab = 'drawing' | 'data';

interface SidebarProps {
  map: maplibregl.Map | null;
  annotationStore: AnnotationStore;
  shapeStore: ShapeStore;
  markerStore: MarkerStore;
  arrowStore: ArrowStore;
  overlay: OverlaySettings;
  setOverlay: React.Dispatch<React.SetStateAction<OverlaySettings>>;
  legendEntries: LegendEntry[];
  setLegendEntries: React.Dispatch<React.SetStateAction<LegendEntry[]>>;
  aspectRatio: AspectRatio;
  setAspectRatio: React.Dispatch<React.SetStateAction<AspectRatio>>;
}

export function Sidebar({ map, annotationStore, shapeStore, markerStore, arrowStore, overlay, setOverlay, legendEntries, setLegendEntries, aspectRatio, setAspectRatio }: SidebarProps) {
  const [activeTool, setActiveTool] = useState<ActiveTool>(null);
  const [tab, setTab] = useState<SidebarTab>('drawing');

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Editorial Map Studio</h1>
        <p>Clean & Simple Maps</p>
      </div>

      <div className="sidebar-section">
        <h2>Navigate</h2>
        <SearchBar map={map} shapeStore={shapeStore} setActiveTool={setActiveTool} />
      </div>

      <div className="sidebar-tab-bar">
        <button
          className={`sidebar-tab-btn ${tab === 'drawing' ? 'active' : ''}`}
          onClick={() => setTab('drawing')}
        >
          Drawing
        </button>
        <button
          className={`sidebar-tab-btn ${tab === 'data' ? 'active' : ''}`}
          onClick={() => setTab('data')}
        >
          Data
        </button>
      </div>

      <div style={tab !== 'drawing' ? { display: 'none' } : undefined}>
        <div className="sidebar-section">
          <h2>Layer Toggles</h2>
          <LayerToggles map={map} />
        </div>

        <div className="sidebar-section">
          <h2>Drawing Tools</h2>
          <DrawingTools
            map={map}
            store={annotationStore}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
          <MarkerTools
            map={map}
            store={markerStore}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
          <ArrowTools
            map={map}
            store={arrowStore}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
          <ShapeTools
            map={map}
            store={shapeStore}
            activeTool={activeTool}
            setActiveTool={setActiveTool}
          />
        </div>

        <div className="sidebar-section">
          <h2>Legend</h2>
          <LegendBuilder entries={legendEntries} setEntries={setLegendEntries} />
        </div>
      </div>

      <div className="sidebar-section" style={tab !== 'data' ? { display: 'none' } : undefined}>
        <DataTools map={map} />
      </div>

      <div className="sidebar-section">
        <h2>Export</h2>
        <ExportTools
          map={map}
          overlay={overlay}
          setOverlay={setOverlay}
          legendEntries={legendEntries}
          annotationStore={annotationStore}
          shapeStore={shapeStore}
          markerStore={markerStore}
          arrowStore={arrowStore}
          aspectRatio={aspectRatio}
          setAspectRatio={setAspectRatio}
        />
      </div>

      <div className="sidebar-footer">
        Designed by Anurag Papolu &middot; <a href="https://tally.so/r/Ek6xeN" target="_blank" rel="noopener noreferrer" className="feedback-link">Feedback</a> &middot; <a href="https://github.com/anuragpapolu10/editorial-map-studio" target="_blank" rel="noopener noreferrer" className="github-link">GitHub</a>
      </div>
    </div>
  );
}
