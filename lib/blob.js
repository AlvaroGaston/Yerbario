import { del, put } from '@vercel/blob';
import { HttpError } from './http.js';

function validBlobUrl(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'La URL de la foto no es válida.');
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new HttpError(400, 'La URL de la foto no es válida.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) {
    throw new HttpError(400, 'Solo se pueden borrar fotos de Vercel Blob.');
  }
  return parsed.href;
}

export async function uploadPhoto(bytes, contentType = 'image/jpeg') {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN.');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new HttpError(415, 'El formato de imagen no está permitido.');
  if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) throw new HttpError(413, 'La imagen debe pesar hasta 1,5 MB.');
  const signatures = {
    'image/jpeg': bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    'image/png': bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'image/webp': bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
  };
  if (!signatures[contentType]) throw new HttpError(415, 'El contenido no coincide con el formato de imagen declarado.');
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[contentType];
  const result = await put(`yerbario/foto.${extension}`, bytes, {
    access: 'public',
    addRandomSuffix: true,
    contentType,
  });
  return result.url;
}

export async function deletePhoto(url) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Falta BLOB_READ_WRITE_TOKEN.');
  await del(validBlobUrl(url));
}

export async function deletePhotoIfUnused(sql, url) {
  const safeUrl = validBlobUrl(url);
  const [reference] = await sql`SELECT 1 FROM yerbas WHERE fotos ? ${safeUrl} LIMIT 1`;
  if (reference) return false;
  await deletePhoto(safeUrl);
  return true;
}
