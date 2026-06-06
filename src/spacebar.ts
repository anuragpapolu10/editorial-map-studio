/**
 * Shared spacebar state — hold Space to pan (hand tool).
 * Drawing tools check isSpaceHeld() to step aside and let MapLibre drag-pan through.
 */

let held = false;
const listeners = new Set<(held: boolean) => void>();

function setHeld(val: boolean) {
  if (held === val) return;
  held = val;
  for (const fn of listeners) fn(val);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    // Prevent page scroll when space is pressed over the map
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') e.preventDefault();
    setHeld(true);
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') setHeld(false);
});

// Also release on window blur (e.g. user alt-tabs while holding space)
window.addEventListener('blur', () => setHeld(false));

export function isSpaceHeld() { return held; }

export function subscribeSpace(fn: (held: boolean) => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
