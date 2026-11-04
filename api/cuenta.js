import { db, ensureSchema } from '../lib/db.js';
import { checkAttemptLimit, createSessionCookie, failedAttempt, hashPassword, requireAuth } from '../lib/auth.js';
import {
  MINUTOS_RECUPERAR, MINUTOS_VERIFICAR, buscarUsuario, consumirToken, crearToken, normalizarEmail, validarContrasenas,
} from '../lib/cuentas.js';
import { enviarRecuperacion, enviarVerificacion } from '../lib/correo.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

// Acciones de cuenta en una sola función (el plan gratuito de Vercel limita la cantidad de funciones):
//   POST /api/cuenta?accion=verificar    { token }                       confirma el correo e inicia sesión
//   POST /api/cuenta?accion=reenviar     { identificador }               reenvía el correo de confirmación
//   POST /api/cuenta?accion=recuperar    { email }                       manda el enlace para cambiar la contraseña
//   POST /api/cuenta?accion=restablecer  { token, password, password2 }  cambia la contraseña e inicia sesión
//   POST /api/cuenta?accion=email        { email }                       (con sesión) agrega o cambia el correo

const RESPUESTA_GENERICA_REENVIO = 'Si hay una cuenta sin confirmar con ese dato, te enviamos un correo nuevo.';
const RESPUESTA_GENERICA_RECUPERAR = 'Si hay una cuenta con ese correo, te enviamos un enlace para elegir una contraseña nueva.';

function accionPedida(req) {
  return req.query?.accion ?? new URL(req.url || '/', 'http://localhost').searchParams.get('accion');
}

// Cada envío de correo cuenta como intento, para que no se pueda usar la app para mandar spam.
function limitarCorreos(req) {
  checkAttemptLimit(req, 'correo');
  failedAttempt(req, 'correo');
}

const acciones = {
  async verificar(req, res, body, sql) {
    const userId = await consumirToken(sql, body.token, 'verificar');
    if (!userId) throw new HttpError(400, 'El enlace para confirmar el correo venció o ya se usó. Pedí uno nuevo desde "Iniciar sesión".');
    const [user] = await sql`UPDATE usuarios SET email_verificado = true WHERE id = ${userId} RETURNING usuario`;
    res.setHeader('Set-Cookie', createSessionCookie(userId));
    return json(res, 200, { authenticated: true, usuario: user.usuario });
  },

  async reenviar(req, res, body, sql) {
    limitarCorreos(req);
    const user = await buscarUsuario(sql, body.identificador);
    if (user?.email && !user.email_verificado) {
      const token = await crearToken(sql, user.id, 'verificar', MINUTOS_VERIFICAR);
      await enviarVerificacion(req, { email: user.email, usuario: user.usuario, token });
    }
    return json(res, 200, { ok: true, mensaje: RESPUESTA_GENERICA_REENVIO });
  },

  async recuperar(req, res, body, sql) {
    limitarCorreos(req);
    const email = normalizarEmail(body.email);
    const user = await buscarUsuario(sql, email);
    if (user) {
      const token = await crearToken(sql, user.id, 'recuperar', MINUTOS_RECUPERAR);
      await enviarRecuperacion(req, { email: user.email, usuario: user.usuario, token });
    }
    return json(res, 200, { ok: true, mensaje: RESPUESTA_GENERICA_RECUPERAR });
  },

  async restablecer(req, res, body, sql) {
    validarContrasenas(body.password, body.password2);
    const userId = await consumirToken(sql, body.token, 'recuperar');
    if (!userId) throw new HttpError(400, 'El enlace para cambiar la contraseña venció o ya se usó. Pedí uno nuevo.');
    const passwordHash = await hashPassword(body.password);
    // Si recibió el correo, el correo es suyo: también queda confirmado.
    const [user] = await sql`UPDATE usuarios SET password_hash = ${passwordHash}, email_verificado = true
      WHERE id = ${userId} RETURNING usuario`;
    await sql`DELETE FROM email_tokens WHERE user_id = ${userId} AND tipo = 'recuperar'`;
    res.setHeader('Set-Cookie', createSessionCookie(userId));
    return json(res, 200, { authenticated: true, usuario: user.usuario });
  },

  async email(req, res, body, sql) {
    const session = requireAuth(req, res);
    if (!session) return;
    limitarCorreos(req);
    const email = normalizarEmail(body.email);
    const [ocupado] = await sql`SELECT 1 FROM usuarios WHERE lower(email) = ${email} AND id <> ${session.id}`;
    if (ocupado) throw new HttpError(409, 'Ya hay otra cuenta con ese correo.');
    const [anterior] = await sql`SELECT usuario, email, email_verificado FROM usuarios WHERE id = ${session.id}`;
    if (!anterior) throw new HttpError(401, 'La sesión ya no es válida. Iniciá sesión de nuevo.');
    await sql`UPDATE usuarios SET email = ${email}, email_verificado = false WHERE id = ${session.id}`;
    try {
      const token = await crearToken(sql, session.id, 'verificar', MINUTOS_VERIFICAR);
      await enviarVerificacion(req, { email, usuario: anterior.usuario, token });
    } catch (err) {
      await sql`UPDATE usuarios SET email = ${anterior.email}, email_verificado = ${anterior.email_verificado} WHERE id = ${session.id}`;
      throw err;
    }
    return json(res, 200, { email, email_verificado: false });
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const accion = accionPedida(req);
    if (!Object.hasOwn(acciones, accion ?? '')) throw new HttpError(404, 'Esa acción no existe.');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud no es válida.');
    await ensureSchema();
    return await acciones[accion](req, res, body, db());
  } catch (err) {
    return fail(res, err, 'api/cuenta');
  }
}
