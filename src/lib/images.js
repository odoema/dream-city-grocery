import { db } from './supabase.js';

// Product photos live in the private "product-images" bucket; staff see them
// through short-lived signed URLs. Photos are shrunk in the browser first so
// the till stays fast on slow connections.

const BUCKET = 'product-images';
const cache = new Map(); // path -> { url, expires }

export async function shrinkImage(file, max = 512, quality = 0.82) {
  if (!/^image\//.test(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).');
  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not process this photo.');
  return blob;
}

function loadBitmap(file) {
  if (window.createImageBitmap) return createImageBitmap(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read this photo.'));
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadProductImage(productId, file) {
  const blob = await shrinkImage(file);
  const path = `products/${productId}-${Date.now()}.jpg`;
  const { error } = await db().storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw new Error('Photo upload failed: ' + error.message);
  return path;
}

export async function removeProductImage(path) {
  if (!path) return;
  await db().storage.from(BUCKET).remove([path]).catch(() => {});
  cache.delete(path);
}

// Returns Map(path -> url) for the given storage paths.
export async function imageUrls(paths) {
  const now = Date.now();
  const out = new Map();
  const need = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = cache.get(p);
    if (hit && hit.expires > now + 60000) out.set(p, hit.url); else need.push(p);
  }
  for (let i = 0; i < need.length; i += 100) {
    const part = need.slice(i, i + 100);
    const { data, error } = await db().storage.from(BUCKET).createSignedUrls(part, 3600 * 6);
    if (error) { console.warn('Product images unavailable:', error.message); continue; }
    for (const row of Array.isArray(data) ? data : []) {
      if (row.signedUrl) {
        cache.set(row.path, { url: row.signedUrl, expires: now + 3600 * 6 * 1000 });
        out.set(row.path, row.signedUrl);
      }
    }
  }
  return out;
}
