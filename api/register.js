import { db, ensureSchema, completeOwnershipMigration } from '../lib/db.js';
import { checkAttemptLimit, failedAttempt, hashPassword, normalizeUsername } from '../lib/auth.js';
import { MINUTOS_VERIFICAR, crearToken, normalizarEmail, validarContrasenas } from '../lib/cuentas.js';
import { enviarVerificacion } from '../lib/correo.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

// Crea la cuenta sin verificar y manda el correo de confirmación. No inicia sesión:
// se entra recién al abrir el enlace del correo.
export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    checkAttemptLimit(req, 'register');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud de registro no es válida.');
    const email = normalizarEmail(body.email);
    const usuario = normalizeUsername(body.usuario);
    validarContrasenas(body.password, body.password2);

    await ensureSchema();
    const sql = db();
    const [existente] = await sql`SELECT lower(usuario) = ${usuario} AS mismo_usuario FROM usuarios
      WHERE lower(usuario) = ${usuario} OR lower(email) = ${email} LIMIT 1`;
    if (existente) {
      failedAttempt(req, 'register');
      throw new HttpError(409, existente.mismo_usuario ? 'Ese nombre de usuario ya está en uso.' : 'Ya hay una cuenta con ese correo.');
    }

    const passwordHash = await hashPassword(body.password);
    let user;
    try {
      [user] = await sql`INSERT INTO usuarios (usuario, password_hash, email, email_verificado)
        VALUES (${usuario}, ${passwordHash}, ${email}, false) RETURNING id`;
    } catch (err) {
      if (err.code === '23505') throw new HttpError(409, 'Ese usuario o correo ya está registrado.');
      throw err;
    }

    try {
      const token = await crearToken(sql, user.id, 'verificar', MINUTOS_VERIFICAR);
      await enviarVerificacion(req, { email, usuario, token });
    } catch (err) {
      // Sin correo no se puede activar la cuenta: se borra para poder reintentar con los mismos datos.
      await sql`DELETE FROM usuarios WHERE id = ${user.id}`;
      throw err;
    }

    await completeOwnershipMigration();
    return json(res, 201, { pendiente: true, email });
  } catch (err) {
    return fail(res, err, 'api/register');
  }
}
