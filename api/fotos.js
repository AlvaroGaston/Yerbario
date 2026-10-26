import { deletePhotoIfUnused, uploadPhoto } from '../lib/blob.js';
import { requireAuth } from '../lib/auth.js';
import { fail, HttpError, json, methodNotAllowed, readBytes, readJson } from '../lib/http.js';
import { db, ensureSchema } from '../lib/db.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!['POST', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['POST', 'DELETE']);
  if (!requireAuth(req, res)) return;
  try {
    if (req.method === 'POST') {
      const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const bytes = await readBytes(req, 1.5 * 1024 * 1024);
      const url = await uploadPhoto(bytes, contentType);
      return json(res, 201, { url });
    }
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud para borrar la foto no es válida.');
    await ensureSchema();
    const deleted = await deletePhotoIfUnused(db(), body.url);
    if (!deleted) throw new HttpError(409, 'La foto todavía está asociada a una yerba.');
    return json(res, 200, { deleted: true });
  } catch (error) {
    return fail(res, error);
  }
}
