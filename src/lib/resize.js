// Draggable column borders. Sizes are stored per browser and come back after a refresh.
// Double-click a border to return it to the default size.

const KEY = 'ui.sizes.v1';
const DEFAULTS = { '--sidebar-w': '236px', '--cart-w': '380px', '--cart-split': '50%' };

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function save(sizes) { try { localStorage.setItem(KEY, JSON.stringify(sizes)); } catch { /* private mode */ } }

// Apply saved sizes once at start-up.
export function applySavedSizes() {
  const sizes = load();
  for (const [name, value] of Object.entries(sizes)) if (name in DEFAULTS) document.documentElement.style.setProperty(name, value);
}

/**
 * Turn `handle` into a drag handle that sets CSS variable `name`.
 * compute(event) returns the new value in px (or % for the cart split); it is clamped to [min, max].
 */
export function makeResizer(handle, { name, axis = 'x', min, max, compute, unit = 'px' }) {
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
  handle.tabIndex = 0;
  handle.title = 'Drag to resize · double-click to reset';
  const root = document.documentElement;
  const set = v => {
    const clamped = Math.round(Math.min(max(), Math.max(min(), v)) * 10) / 10;
    root.style.setProperty(name, clamped + unit);
    return clamped + unit;
  };
  const persist = value => { const s = load(); s[name] = value; save(s); };

  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing', axis === 'x' ? 'resizing-x' : 'resizing-y');
    let last = null;
    const move = ev => { last = set(compute(ev)); };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing', 'resizing-x', 'resizing-y');
      if (last) persist(last);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  // Keyboard: arrow keys move the border by 16 px (or 2%).
  handle.addEventListener('keydown', e => {
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const fwd = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== back && e.key !== fwd) return;
    e.preventDefault();
    const current = parseFloat(getComputedStyle(root).getPropertyValue(name)) || parseFloat(DEFAULTS[name]);
    const step = unit === '%' ? 2 : 16;
    persist(set(current + (e.key === fwd ? step : -step) * (handle.dataset.invert ? -1 : 1)));
  });

  handle.addEventListener('dblclick', () => {
    root.style.setProperty(name, DEFAULTS[name]);
    const s = load(); delete s[name]; save(s);
  });
}
