import { db, ensureSchema } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { fail, json, methodNotAllowed } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const session = requireAuth(req, res);
  if (!session) return;
  try {
    await ensureSchema();
    const sql = db();
    const [user] = await sql`SELECT usuario FROM usuarios WHERE id = ${session.id}`;
    if (!user) return json(res, 401, { error: 'La sesión ya no es válida. Iniciá sesión de nuevo.' });
    return json(res, 200, { authenticated: true, usuario: user.usuario });
  } catch (err) {
    console.error('[api/session] error', err.message);
    return fail(res, err);
  }
}
