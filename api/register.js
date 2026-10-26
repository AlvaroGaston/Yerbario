import { db, ensureSchema, completeOwnershipMigration } from '../lib/db.js';
import { checkAttemptLimit, compareSecret, createSessionCookie, failedAttempt, hashPassword, normalizeUsername, successfulAttempt, validPassword } from '../lib/auth.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    checkAttemptLimit(req, 'register');
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud de registro no es válida.');
    const usuario = normalizeUsername(body.usuario);
    if (!validPassword(body.password)) {
      failedAttempt(req, 'register');
      throw new HttpError(400, 'La contraseña debe tener entre 8 y 256 caracteres.');
    }

    const inviteCode = process.env.INVITE_CODE;
    const inviteRequired = Boolean(inviteCode);
    const inviteValid = inviteRequired && compareSecret(body.codigo, inviteCode);
    const passwordHash = await hashPassword(body.password);
    await ensureSchema();
    const sql = db();
    const [result] = await sql`SELECT * FROM yerbario_register_user(
      ${usuario}, ${passwordHash}, ${inviteRequired}, ${inviteValid}
    )`;

    if (result.error_code) {
      failedAttempt(req, 'register');
      if (result.error_code === 'username_exists') throw new HttpError(409, 'Ese nombre de usuario ya está registrado.');
      if (result.error_code === 'registration_closed') throw new HttpError(403, 'El registro está cerrado.');
      throw new HttpError(403, 'El código de invitación no es válido.');
    }

    successfulAttempt(req, 'register');
    await completeOwnershipMigration();
    res.setHeader('Set-Cookie', createSessionCookie(result.id));
    return json(res, 201, { authenticated: true, usuario: result.usuario });
  } catch (error) {
    return fail(res, error);
  }
}
