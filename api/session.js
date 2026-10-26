import { fail, json, methodNotAllowed } from '../lib/http.js';
import { requireAuth } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  if (!requireAuth(req, res)) return;
  try { return json(res, 200, { authenticated: true }); }
  catch (error) { return fail(res, error); }
}
