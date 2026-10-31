import { fail, json, methodNotAllowed } from '../lib/http.js';
import { clearSessionCookie, requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!requireAuth(req, res)) return;
  try {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return json(res, 200, { authenticated: false });
  } catch (err) {
    return fail(res, err, 'api/logout');
  }
}
