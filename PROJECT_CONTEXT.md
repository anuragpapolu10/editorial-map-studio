# Editorial Map Studio — Project Context

## Purpose
A browser-based editorial map tool. Lets users create clean, publication-style cartographic maps with custom annotations, layer controls, shape/arrow drawing tools, and PNG/SVG export.

## Tech Stack
- **Vite + React + TypeScript**
- **MapLibre GL JS** — vector map renderer
- **Protomaps PMTiles** — vector tiles
- **OpenMapTiles font server** — `https://fonts.openmaptiles.org/{fontstack}/{range}.pbf`
- **@protomaps/basemaps** — layer generator with custom editorial flavor

## Project Location
`C:\Megasync\Design Projects\editorialmaps`

## Dev Server
`npm run dev` (runs on localhost:5173)

## File Structure

### Core Files
| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component. Creates stores via `useRef`, passes to Sidebar. |
| `src/App.css` | All styles (single stylesheet). |
| `src/editorial-style.ts` | Editorial color flavor for protomaps basemap layers. |
| `src/annotations.ts` | `TextAnnotation` interface + `AnnotationStore` class with command-pattern undo/redo. |
| `src/shapes.ts` | `ShapeAnnotation` interface + `ShapeStore` class + geometry helpers (resize, rotate, translate). |
| `src/arrows.ts` | `ArrowAnnotation` interface + `ArrowStore` class with bezier curve support. |
| `src/components/MapView.tsx` | MapLibre map. Creates all GeoJSON sources + layers on `map.load`. |
| `src/components/DrawingTools.tsx` | Text annotation tool: placement, selection, drag-to-move, inline editing, styling. |
| `src/components/ShapeTools.tsx` | Rectangle, ellipse, line, polygon tools with resize handles and vertex dragging. |
| `src/components/ArrowTools.tsx` | Arrow tool with draggable bezier control points. |
| `src/components/MarkerTools.tsx` | Marker placement with symbol and color options. |
| `src/components/LayerToggles.tsx` | Layer visibility toggles with collapsible sub-options. |
| `src/components/SearchBar.tsx` | Place search with Nominatim geocoding. |
| `src/components/Sidebar.tsx` | Layout shell: Navigate, Layer Toggles, Drawing Tools, Legend, Export sections. |
| `src/crossSelect.ts` | Cross-tool selection: click any element to auto-switch to its tool. |

### Key Architecture Decisions

1. **All map layers created in MapView.tsx** — avoids race condition with `map.on('load')`. Tool components only read/write GeoJSON source data.

2. **8 symbol layers for text** — one per font combo (sans × normal/bold × normal/italic). Each layer has a filter matching `fontFamily`, `fontWeight`, `fontStyle` properties.

3. **Store pattern** — standalone classes (not React state) with subscriber pattern. Mutations push to undoStack and notify subscribers. Undo/redo pops and replays.

4. **Shape handles** — separate `shape-handles` GeoJSON source + circle layer. Handles sync via useEffect on selection changes. During drag, handles update via direct source manipulation for smooth live preview.
