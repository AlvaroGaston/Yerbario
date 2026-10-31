import { promisify } from 'node:util';
import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { HttpError, json, logError } from './http.js';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'yerbario_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const ATTEMPT_WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();
const PASSWORD_KEY_LENGTH = 64;

function sessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Falta SESSION_SECRET.');
  if (secret.length < 32) throw new Error('SESSION_SECRET debe tener al menos 32 caracteres.');
  return secret;
}

function signature(value) {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function requestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return req.headers['x-real-ip'] || (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'desconocida';
}

function attemptRecord(req, action) {
  const key = `${action}:${requestIp(req)}`;
  const now = Date.now();
  for (const [storedKey, record] of attempts) {
    if (record.until <= now) attempts.delete(storedKey);
  }
  let record = attempts.get(key);
  if (!record) {
    record = { count: 0, until: now + ATTEMPT_WINDOW };
    attempts.set(key, record);
  }
  if (record.count >= MAX_ATTEMPTS) throw new HttpError(429, 'Demasiados intentos. Probá de nuevo en unos minutos.');
  if (attempts.size > 10000) attempts.clear();
  return { key, record };
}

export function failedAttempt(req, action) {
  const { record } = attemptRecord(req, action);
  record.count++;
}

export function checkAttemptLimit(req, action) {
  attemptRecord(req, action);
}

export function successfulAttempt(req, action) {
  attempts.delete(`${action}:${requestIp(req)}`);
}

export function normalizeUsername(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresá un nombre de usuario válido.');
  const username = value.trim().toLowerCase();
  if (!/^[\p{L}\p{N}_.-]{3,32}$/u.test(username)) {
    throw new HttpError(400, 'El usuario debe tener entre 3 y 32 caracteres: letras, números, punto, guion o guion bajo.');
  }
  return username;
}

export function validPassword(value) {
  return typeof value === 'string' && value.length >= 8 && value.length <= 256;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, PASSWORD_KEY_LENGTH);
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(key).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  let salt = Buffer.alloc(16);
  let expected = Buffer.alloc(PASSWORD_KEY_LENGTH);
  let validHash = false;
  if (typeof encoded === 'string') {
    const parts = encoded.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      try {
        const parsedSalt = Buffer.from(parts[1], 'base64url');
        const parsedKey = Buffer.from(parts[2], 'base64url');
        if (parsedSalt.length === 16 && parsedKey.length === PASSWORD_KEY_LENGTH) {
          salt = parsedSalt;
          expected = parsedKey;
          validHash = true;
        }
      } catch {
        validHash = false;
      }
    }
  }
  const derived = Buffer.from(await scrypt(password, salt, PASSWORD_KEY_LENGTH));
  return timingSafeEqual(derived, expected) && validHash;
}

export function compareSecret(candidate, expected) {
  const validCandidate = typeof candidate === 'string' && candidate.length <= 256;
  const candidateHash = createHash('sha256').update(validCandidate ? candidate : '').digest();
  const expectedHash = createHash('sha256').update(typeof expected === 'string' ? expected : '').digest();
  return timingSafeEqual(candidateHash, expectedHash) && validCandidate && typeof expected === 'string';
}

function cookieValue(req) {
  const cookies = (req.headers.cookie || '').split(';');
  const entry = cookies.map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`));
  return entry ? entry.slice(COOKIE_NAME.length + 1) : '';
}

export function createSessionCookie(userId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${userId}.${expires}`;
  return `${COOKIE_NAME}=${encodeURIComponent(`${payload}.${signature(payload)}`)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function verifySession(req) {
  const token = cookieValue(req);
  let decoded;
  try { decoded = decodeURIComponent(token); }
  catch { return null; }
  const [userIdText, expiresText, supplied, extra] = decoded.split('.');
  const userId = Number(userIdText);
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !supplied || extra) return null;
  const payload = `${userId}.${expiresText}`;
  const expected = signature(payload);
  const actualBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  return { id: userId };
}

export function requireAuth(req, res) {
  try {
    const user = verifySession(req);
    if (user) return user;
  } catch (err) {
    logError('auth', err);
    return json(res, 500, { error: 'No se pudo verificar la sesión.' });
  }
  json(res, 401, { error: 'Iniciá sesión para continuar.' });
  return null;
}
