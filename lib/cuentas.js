import { createHash, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { validPassword } from './auth.js';

export const MINUTOS_VERIFICAR = 24 * 60;
export const MINUTOS_RECUPERAR = 60;

export function normalizarEmail(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresá un correo válido.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@"<>()[\]\\,;:]+@[^\s@"<>()[\]\\,;:]+\.[a-z]{2,}$/i.test(email)) {
    throw new HttpError(400, 'Ingresá un correo válido.');
  }
  return email;
}

export function validarContrasenas(password, password2) {
  if (!validPassword(password)) throw new HttpError(400, 'La contraseña debe tener entre 8 y 256 caracteres.');
  if (password !== password2) throw new HttpError(400, 'Las contraseñas no coinciden.');
}

const hashToken = token => createHash('sha256').update(token).digest('hex');

// Crea un enlace de un solo uso. En la base solo queda el hash; los enlaces anteriores del mismo tipo se anulan.
export async function crearToken(sql, userId, tipo, minutos) {
  const token = randomBytes(32).toString('base64url');
  await sql`DELETE FROM email_tokens WHERE user_id = ${userId} AND tipo = ${tipo}`;
  await sql`INSERT INTO email_tokens (user_id, tipo, token_hash, expira)
    VALUES (${userId}, ${tipo}, ${hashToken(token)}, now() + make_interval(mins => ${minutos}))`;
  return token;
}

// Marca el enlace como usado y devuelve el usuario, o null si venció, ya se usó o no existe.
export async function consumirToken(sql, token, tipo) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await sql`UPDATE email_tokens SET usado = now()
    WHERE token_hash = ${hashToken(token)} AND tipo = ${tipo} AND usado IS NULL AND expira > now()
    RETURNING user_id`;
  return row ? row.user_id : null;
}

// Busca por usuario o por correo (si tiene @).
export async function buscarUsuario(sql, identificador) {
  if (typeof identificador !== 'string' || !identificador.trim() || identificador.length > 254) return null;
  const valor = identificador.trim().toLowerCase();
  const [user] = valor.includes('@')
    ? await sql`SELECT id, usuario, email, email_verificado, password_hash FROM usuarios WHERE lower(email) = ${valor}`
    : await sql`SELECT id, usuario, email, email_verificado, password_hash FROM usuarios WHERE lower(usuario) = ${valor}`;
  return user || null;
}
