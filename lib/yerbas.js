import { HttpError } from './http.js';

export const CRITERIOS = ['sabor', 'aroma', 'amargor', 'espuma', 'rendimiento', 'polvo', 'precio'];
const TIPOS = ['Con palo (tradicional)', 'Despalada / sin palo', 'Compuesta con hierbas', 'Orgánica', 'Barbacuá / ahumada', 'Saborizada', 'Suave / baja astringencia', 'Otra'];
const ORIGENES = ['Misiones', 'Corrientes', 'Brasil', 'Paraguay', 'Uruguay', 'Otro'];
const MOLIENDAS = ['Fina', 'Media', 'Gruesa'];
const MODOS = ['Amargo', 'Dulce', 'Tereré', 'Cocido'];
const RECOMPRA = ['', 'si', 'tal', 'no'];

function text(value, label, max, required = false) {
  if (value == null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${label} no es válido.`);
  const result = value.trim();
  if (result.length > max) throw new HttpError(400, `${label} supera el largo máximo permitido.`);
  if (required && !result) throw new HttpError(400, `${label} es obligatorio.`);
  return result;
}

function number(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false, nullable = true } = {}) {
  if (value === '' || value == null) {
    if (nullable) return null;
    throw new HttpError(400, `${label} es obligatorio.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) {
    throw new HttpError(400, `${label} no está dentro del rango permitido.`);
  }
  return result;
}

function score(value, label) {
  const result = value == null || value === '' ? 0 : Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 5 || result * 2 !== Math.trunc(result * 2)) {
    throw new HttpError(400, `${label} debe ser un puntaje de 0 a 5 en pasos de 0,5.`);
  }
  return result;
}

function enumValue(value, choices, label) {
  const result = value == null ? '' : text(value, label, 80);
  if (!choices.includes(result)) throw new HttpError(400, `${label} no es válido.`);
  return result;
}

function dateValue(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'La fecha debe tener formato YYYY-MM-DD.');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'La fecha no existe.');
  return value;
}

function photoUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new HttpError(400, 'Una URL de foto no es válida.');
  let parsed;
  try {
    parsed = new URL(value);
    if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.public.blob.vercel-storage.com')) throw new Error('host');
  } catch {
    throw new HttpError(400, 'Las fotos deben ser URLs seguras de Vercel Blob.');
  }
  return parsed.href;
}

export function validateYerba(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Los datos de la yerba no son válidos.');
  const estado = enumValue(input.estado ?? 'probada', ['probada', 'quiero'], 'El estado');
  const puntajes = {};
  if (input.puntajes != null && (typeof input.puntajes !== 'object' || Array.isArray(input.puntajes))) {
    throw new HttpError(400, 'Los puntajes no tienen un formato válido.');
  }
  const values = input.puntajes || {};
  for (const key of CRITERIOS) puntajes[key] = score(values[key], `El puntaje de ${key}`);
  const tags = input.tags == null ? [] : input.tags;
  if (!Array.isArray(tags) || tags.length > 20) throw new HttpError(400, 'Se permiten hasta 20 etiquetas.');
  const fotos = input.fotos == null ? [] : input.fotos;
  if (!Array.isArray(fotos) || fotos.length > 6) throw new HttpError(400, 'Se permiten hasta 6 fotos por yerba.');
  const fecha = dateValue(input.fecha);
  if (input.favorita != null && typeof input.favorita !== 'boolean') throw new HttpError(400, 'El estado de favorita no es válido.');
  const precio = number(input.precio, 'El precio', { max: 9999999999.99 });
  if (precio != null && Math.abs(precio * 100 - Math.round(precio * 100)) > 1e-7) {
    throw new HttpError(400, 'El precio puede tener hasta dos decimales.');
  }

  return {
    estado,
    nombre: text(input.nombre, 'El nombre', 80, true),
    marca: text(input.marca, 'La marca', 60),
    tipo: enumValue(input.tipo, ['', ...TIPOS], 'El tipo'),
    origen: enumValue(input.origen, ['', ...ORIGENES], 'El origen'),
    molienda: enumValue(input.molienda, ['', ...MOLIENDAS], 'La molienda'),
    modo: enumValue(input.modo, ['', ...MODOS], 'El modo'),
    estacionamiento: number(input.estacionamiento, 'El estacionamiento', { max: 60, integer: true }),
    gramos: number(input.gramos, 'El contenido', { max: 100000, integer: true }),
    precio,
    lugar: text(input.lugar, 'El lugar', 60),
    fecha,
    puntajes,
    general: score(input.general, 'El puntaje general'),
    recompra: enumValue(input.recompra, RECOMPRA, 'La recompra'),
    favorita: input.favorita ?? false,
    pros: text(input.pros, 'Lo bueno', 600),
    contras: text(input.contras, 'Lo malo', 600),
    notas: text(input.notas, 'Las notas', 2000),
    tags: [...new Set(tags.map(tag => text(tag, 'Una etiqueta', 50).toLowerCase()).filter(Boolean))],
    fotos: fotos.map(photoUrl),
  };
}
