import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { HttpError, json } from './http.js';

const COOKIE_NAME = 'yerbario_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const attempts = new Map();

function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function secrets() {
  if (!process.env.APP_PASSWORD || !process.env.SESSION_SECRET) throw new Error('Falta configurar APP_PASSWORD o SESSION_SECRET.');
  if (process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  return { password: process.env.APP_PASSWORD, secret: process.env.SESSION_SECRET };
}

function passwordMatches(candidate, actual) {
  const a = createHash('sha256').update(candidate).digest();
  const b = createHash('sha256').update(actual).digest();
  return timingSafeEqual(a, b);
}

function cookieValue(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const entry = cookies.map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : '';
}

export function createSessionCookie() {
  const { secret } = secrets();
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = String(expires);
  const value = `${payload}.${signature(payload, secret)}`;
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function verifySession(req) {
  const { secret } = secrets();
  const token = cookieValue(req);
  const [expires, supplied, extra] = token.split('.');
  if (!expires || !supplied || extra || Number(expires) <= Math.floor(Date.now() / 1000)) return false;
  const expected = signature(expires, secret);
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireAuth(req, res) {
  try {
    if (verifySession(req)) return true;
  } catch (error) {
    console.error('No se pudo verificar la sesión:', error);
    json(res, 500, { error: 'No se pudo verificar la sesión.' });
    return false;
  }
  json(res, 401, { error: 'Iniciá sesión para continuar.' });
  return false;
}

export function login(req, res, candidate) {
  const { password } = secrets();
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() || req.socket?.remoteAddress || 'desconocida';
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, until: now + 15 * 60 * 1000 };
  if (record.until <= now) { record.count = 0; record.until = now + 15 * 60 * 1000; }
  if (record.count >= 8) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
  if (typeof candidate !== 'string' || candidate.length > 1024 || !passwordMatches(candidate, password)) {
    record.count++;
    attempts.set(ip, record);
    throw new HttpError(401, 'La contraseña no es correcta.');
  }
  attempts.delete(ip);
  res.setHeader('Set-Cookie', createSessionCookie());
}
