import { db, ensureSchema } from '../lib/db.js';
import { checkAttemptLimit, createSessionCookie, failedAttempt, normalizeUsername, successfulAttempt, verifyPassword } from '../lib/auth.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    checkAttemptLimit(req, 'login');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud de inicio de sesión no es válida.');
    const usuario = normalizeUsername(body.usuario);
    if (typeof body.password !== 'string' || body.password.length > 256) {
      failedAttempt(req, 'login');
      throw new HttpError(401, 'El usuario o la contraseña no son correctos.');
    }
    await ensureSchema();
    const sql = db();
    const [user] = await sql`SELECT id, password_hash FROM usuarios WHERE lower(usuario) = ${usuario}`;
    if (!await verifyPassword(body.password, user?.password_hash)) {
      failedAttempt(req, 'login');
      throw new HttpError(401, 'El usuario o la contraseña no son correctos.');
    }
    successfulAttempt(req, 'login');
    res.setHeader('Set-Cookie', createSessionCookie(user.id));
    return json(res, 200, { authenticated: true, usuario });
  } catch (error) {
    return fail(res, error);
  }
}
