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
    const [user] = await sql`SELECT usuario, email, email_verificado, nombre, bio, avatar, privado, perfil_config,
        (SELECT count(*)::int FROM notificaciones WHERE user_id = ${session.id} AND NOT leida) AS no_leidas
      FROM usuarios WHERE id = ${session.id}`;
    if (!user) return json(res, 401, { error: 'La sesión ya no es válida. Iniciá sesión de nuevo.' });
    return json(res, 200, {
      authenticated: true, usuario: user.usuario, email: user.email, email_verificado: user.email_verificado,
      nombre: user.nombre, bio: user.bio, avatar: user.avatar, privado: user.privado,
      config: { estadisticas: true, quiero: true, seguidores: true, ...(user.perfil_config || {}) },
      no_leidas: user.no_leidas,
    });
  } catch (err) {
    return fail(res, err, 'api/session');
  }
}
