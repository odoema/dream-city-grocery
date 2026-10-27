// Timeless line icons (24×24 grid, 1.75 stroke, round joins). They take the
// text colour (currentColor), so they follow the brand palette automatically.
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  sell: '<path d="M3 4h2.5l2.2 11.2a1.5 1.5 0 0 0 1.5 1.3h8.6a1.5 1.5 0 0 0 1.5-1.2L21 8H6.2"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/>',
  products: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  customers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  buy: '<path d="M3 7h11v9H3z"/><path d="M14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  inventory: '<path d="M4 4h16v5H4z"/><path d="M5 9v11h14V9"/><path d="M10 13h4"/>',
  count: '<path d="M9 4h6v3H9z"/><path d="M15 5h3v16H6V5h3"/><path d="m9 14 2 2 4-4"/>',
  reports: '<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-7"/>',
  accounts: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11"/><path d="M9 8h6"/>',
  import: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 17v3h16v-3"/>',
  staff: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.8 2.9-6 6.5-6s6.5 2.2 6.5 6"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.3c2.2.7 3.5 2.6 3.5 5.7"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  dashboard: '<path d="M3 13a9 9 0 0 1 18 0"/><path d="m12 13 4-4"/><circle cx="12" cy="13" r="1.6"/><path d="M4 17h16"/><path d="M7 21h10"/>',
  close: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>'
};

export function icon(name) {
  return `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.home}</svg>`;
}

// Trim the white margin around a logo so it fills its frame and looks sharp.
// Falls back to the original image if the browser can't read the pixels.
const trimmed = new Map();
export function trimLogo(url) {
  if (!url) return Promise.resolve(url);
  if (trimmed.has(url)) return trimmed.get(url);
  const job = new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth, hgt = img.naturalHeight;
        const c = document.createElement('canvas'); c.width = w; c.height = hgt;
        const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, w, hgt).data;
        let top = hgt, left = w, right = -1, bottom = -1;
        for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const ink = d[i + 3] > 24 && (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235);
          if (ink) { if (x < left) left = x; if (x > right) right = x; if (y < top) top = y; if (y > bottom) bottom = y; }
        }
        if (right < 0) return resolve(url);
        const pad = Math.round(Math.max(right - left, bottom - top) * 0.04);
        left = Math.max(0, left - pad); top = Math.max(0, top - pad);
        right = Math.min(w - 1, right + pad); bottom = Math.min(hgt - 1, bottom + pad);
        const out = document.createElement('canvas');
        out.width = right - left + 1; out.height = bottom - top + 1;
        const o = out.getContext('2d');
        o.fillStyle = '#FFFFFF'; o.fillRect(0, 0, out.width, out.height);
        o.drawImage(c, left, top, out.width, out.height, 0, 0, out.width, out.height);
        resolve(out.toDataURL('image/png'));
      } catch { resolve(url); }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
  trimmed.set(url, job);
  return job;
}
