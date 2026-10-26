import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';
import { login } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const body = await readJson(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'La solicitud de inicio de sesión no es válida.');
    login(req, res, body.password);
    return json(res, 200, { authenticated: true });
  } catch (error) {
    return fail(res, error);
  }
}
