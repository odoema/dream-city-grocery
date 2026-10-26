import { db } from './supabase.js';

// Upload a shop logo to the public "branding" bucket and return its URL.
export async function uploadLogo(file) {
  if (file.size > 2 * 1024 * 1024) throw new Error('Logo must be smaller than 2 MB.');
  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
  const path = 'logo-' + Date.now() + '.' + ext;
  const { error } = await db().storage.from('branding').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw new Error('Logo upload failed: ' + error.message);
  return db().storage.from('branding').getPublicUrl(path).data.publicUrl;
}
