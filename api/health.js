import { db } from '../lib/db.js';
import { json, logError, methodNotAllowed } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const sql = db();
    await sql`SELECT 1`;
    return json(res, 200, { db: true });
  } catch (err) {
    logError('api/health', err);
    return json(res, 503, { db: false });
  }
}
