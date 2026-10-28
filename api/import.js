import { db, ensureSchema } from '../lib/db.js';
import { deletePhoto, ensureOwnedPhotos, uploadPhoto } from '../lib/blob.js';
import { requireAuth } from '../lib/auth.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';
import { validateYerba } from '../lib/yerbas.js';

function imageFromDataUrl(value) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) throw new HttpError(400, 'Una foto del respaldo tiene un formato no válido.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw new HttpError(400, 'Una foto del respaldo tiene un formato no válido.');
  if (!bytes.length || bytes.length > 1.5 * 1024 * 1024) throw new HttpError(413, 'Una foto supera el límite de 1,5 MB.');
  return { bytes, contentType: match[1] };
}

function importedTimestamp(value, label) {
  if (value == null || value === '') return null;
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 1 || milliseconds > 8.64e15) {
    throw new HttpError(400, `La fecha de ${label} no es válida.`);
  }
  return new Date(milliseconds).toISOString();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const session = requireAuth(req, res);
  if (!session) return;
  const uploaded = [];
  let transactionAttempted = false;
  try {
    const body = await readJson(req);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'El respaldo no tiene un formato válido.');
    const incoming = Array.isArray(body) ? body : body.yerbas;
    if (!Array.isArray(incoming) || incoming.length > 500) throw new HttpError(400, 'El respaldo debe incluir hasta 500 yerbas.');
    await ensureSchema();

    const records = [];
    for (const item of incoming) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new HttpError(400, 'Una yerba del respaldo no tiene un formato válido.');
      if (item.fotos != null && (!Array.isArray(item.fotos) || item.fotos.length > 6)) {
        throw new HttpError(400, 'Cada yerba debe tener hasta 6 fotos.');
      }
      const photos = [];
      if (Array.isArray(item.fotos)) {
        for (const value of item.fotos) {
          if (typeof value === 'string' && value.startsWith('data:image/')) {
            const image = imageFromDataUrl(value);
            const url = await uploadPhoto(image.bytes, image.contentType, session.id);
            uploaded.push(url);
            photos.push(url);
          } else {
            photos.push(value);
          }
        }
      }
      const record = validateYerba({ ...item, fotos: photos });
      ensureOwnedPhotos(record.fotos, session.id);
      records.push({
        ...record,
        creado: importedTimestamp(item.creado, 'creación'),
        actualizado: importedTimestamp(item.actualizado, 'actualización'),
      });
    }
    if (!records.length) return json(res, 200, { imported: 0 });

    const sql = db();
    const payload = JSON.stringify(records);
    const statement = sql`
      WITH incoming AS (
        SELECT * FROM jsonb_to_recordset(${payload}::jsonb) AS x (
          estado text, nombre text, marca text, tipo text, origen text, molienda text, modo text,
          estacionamiento integer, gramos integer, precio numeric, lugar text, fecha date,
          puntajes jsonb, general numeric, recompra text, favorita boolean, pros text,
          contras text, notas text, tags text[], fotos jsonb, creado timestamptz, actualizado timestamptz
        )
      ), deduplicated AS (
        SELECT DISTINCT ON (lower(nombre), lower(marca), fecha) *
        FROM incoming
        ORDER BY lower(nombre), lower(marca), fecha NULLS FIRST
      ), inserted AS (
        INSERT INTO yerbas (
          estado, nombre, marca, tipo, origen, molienda, modo, estacionamiento, gramos,
          precio, lugar, fecha, puntajes, general, recompra, favorita, pros, contras,
          notas, tags, fotos, creado, actualizado, user_id
        )
        SELECT i.estado, i.nombre, i.marca, i.tipo, i.origen, i.molienda, i.modo,
          i.estacionamiento, i.gramos, i.precio, i.lugar, i.fecha, i.puntajes,
          i.general, i.recompra, i.favorita, i.pros, i.contras, i.notas, i.tags, i.fotos,
          COALESCE(i.creado, now()), COALESCE(i.actualizado, i.creado, now()), ${session.id}
        FROM deduplicated i
        WHERE NOT EXISTS (
          SELECT 1 FROM yerbas y
          WHERE y.user_id = ${session.id}
            AND lower(y.nombre) = lower(i.nombre)
            AND lower(y.marca) = lower(i.marca)
            AND y.fecha IS NOT DISTINCT FROM i.fecha
        )
        RETURNING fotos
      )
      SELECT fotos FROM inserted
    `;
    transactionAttempted = true;
    const [, inserted] = await sql.transaction([sql`SELECT pg_advisory_xact_lock(83746291)`, statement]);
    let cleanupPending = false;
    const used = new Set(inserted.flatMap(row => row.fotos || []));
    for (const url of uploaded) if (!used.has(url)) {
      try { await deletePhoto(url, session.id); }
      catch (err) {
        cleanupPending = true;
        console.error('[api/import] error', err.message);
      }
    }
    return json(res, 200, { imported: inserted.length, cleanupPending });
  } catch (err) {
    for (const url of transactionAttempted ? [] : uploaded) {
      try { await deletePhoto(url, session.id); }
      catch (err) { console.error('[api/import] error', err.message); }
    }
    if (transactionAttempted) console.error('La importación falló durante la transacción; se preservan fotos por si hubo confirmación ambigua.');
    console.error('[api/import] error', err.message);
    return fail(res, err);
  }
}
