/**
 * Cross-tool selection: when you click an element from a different tool,
 * auto-switch to that tool and select the element in one click.
 */

import type maplibregl from 'maplibre-gl';
import type { ActiveTool } from './components/Sidebar';
import {
  ANNOTATION_LAYER_IDS, MARKER_LAYER_ID,
  SHAPE_LAYER_IDS, ARROW_SHAFT_LAYER_IDS,
} from './components/MapView';

let pending: { tool: ActiveTool; id: string } | null = null;

export function setPending(tool: ActiveTool, id: string) {
  pending = { tool, id };
}

export function consumePending(): { tool: ActiveTool; id: string } | null {
  const p = pending;
  pending = null;
  return p;
}

/** Hit test all tool layers and return the tool + element id, or null */
export function hitTestAllTools(
  map: maplibregl.Map,
  point: maplibregl.Point,
): { tool: ActiveTool; id: string } | null {
  const bbox: [maplibregl.PointLike, maplibregl.PointLike] =
    [[point.x - 8, point.y - 8], [point.x + 8, point.y + 8]];

  // Check annotations
  const annLayers = ANNOTATION_LAYER_IDS.filter((id) => map.getLayer(id));
  if (annLayers.length > 0) {
    const hits = map.queryRenderedFeatures(bbox, { layers: annLayers });
    if (hits.length > 0 && hits[0].properties?.id) {
      return { tool: 'text', id: hits[0].properties.id };
    }
  }

  // Check markers
  if (map.getLayer(MARKER_LAYER_ID)) {
    const hits = map.queryRenderedFeatures(bbox, { layers: [MARKER_LAYER_ID] });
    if (hits.length > 0 && hits[0].properties?.id) {
      return { tool: 'marker', id: hits[0].properties.id };
    }
  }

  // Check arrows
  const arrowLayers = ARROW_SHAFT_LAYER_IDS.filter((id) => map.getLayer(id));
  if (arrowLayers.length > 0) {
    const hits = map.queryRenderedFeatures(bbox, { layers: arrowLayers });
    if (hits.length > 0 && hits[0].properties?.id) {
      return { tool: 'arrow', id: hits[0].properties.id };
    }
  }

  // Check shapes
  const shapeLayers = SHAPE_LAYER_IDS.filter((id) => map.getLayer(id));
  if (shapeLayers.length > 0) {
    const hits = map.queryRenderedFeatures(bbox, { layers: shapeLayers });
    if (hits.length > 0 && hits[0].properties?.id) {
      return { tool: 'rectangle', id: hits[0].properties.id };
    }
  }

  return null;
}
