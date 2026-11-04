import { db, ensureSchema } from '../lib/db.js';
import { checkAttemptLimit, createSessionCookie, failedAttempt, successfulAttempt, verifyPassword } from '../lib/auth.js';
import { buscarUsuario } from '../lib/cuentas.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

const CREDENCIALES_INVALIDAS = 'El usuario, el correo o la contraseña no son correctos.';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    checkAttemptLimit(req, 'login');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud de inicio de sesión no es válida.');
    // "usuario" se acepta por compatibilidad con la versión anterior del formulario.
    const identificador = body.identificador ?? body.usuario;
    if (typeof body.password !== 'string' || body.password.length > 256) {
      failedAttempt(req, 'login');
      throw new HttpError(401, CREDENCIALES_INVALIDAS);
    }
    await ensureSchema();
    const user = await buscarUsuario(db(), identificador);
    // Se verifica siempre (aunque no exista el usuario) para no revelar cuáles existen por el tiempo de respuesta.
    if (!await verifyPassword(body.password, user?.password_hash)) {
      failedAttempt(req, 'login');
      throw new HttpError(401, CREDENCIALES_INVALIDAS);
    }
    if (user.email && !user.email_verificado) {
      throw new HttpError(403, 'Todavía no confirmaste tu correo. Revisá tu bandeja de entrada (y la de spam).', {
        code: 'email_no_verificado', email: user.email,
      });
    }
    successfulAttempt(req, 'login');
    res.setHeader('Set-Cookie', createSessionCookie(user.id));
    return json(res, 200, { authenticated: true, usuario: user.usuario });
  } catch (err) {
    return fail(res, err, 'api/login');
  }
}
