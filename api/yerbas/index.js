import { db, ensureSchema, serializeYerba } from '../../lib/db.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../../lib/http.js';
import { requireAuth } from '../../lib/auth.js';
import { validateYerba } from '../../lib/yerbas.js';
import { deletePhotoIfUnused, ensureOwnedPhotos } from '../../lib/blob.js';

function requestedId(req) {
  const rawId = req.query?.id ?? new URL(req.url || '/', 'http://localhost').searchParams.get('id');
  if (rawId == null || rawId === '') return null;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'El identificador no es válido.');
  return id;
}

export default async function handler(req, res) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE']);
  const session = requireAuth(req, res);
  if (!session) return;
  try {
    const id = requestedId(req);
    await ensureSchema();
    const sql = db();
    if (req.method === 'GET') {
      if (id != null) {
        const [row] = await sql`SELECT * FROM yerbas WHERE id = ${id} AND user_id = ${session.id}`;
        if (!row) throw new HttpError(404, 'No se encontró esa yerba.');
        return json(res, 200, serializeYerba(row));
      }
      const rows = await sql`SELECT * FROM yerbas WHERE user_id = ${session.id} ORDER BY fecha DESC NULLS LAST, creado DESC`;
      return json(res, 200, rows.map(serializeYerba));
    }
    if (req.method === 'DELETE') {
      if (id != null) {
        const [row] = await sql`DELETE FROM yerbas WHERE id = ${id} AND user_id = ${session.id} RETURNING fotos`;
        if (!row) throw new HttpError(404, 'No se encontró esa yerba.');
        for (const url of new Set(row.fotos || [])) await deletePhotoIfUnused(sql, url, session.id, true);
        return json(res, 200, { deleted: true });
      }
      const confirmation = await readJson(req);
      if (confirmation?.confirm !== true) throw new HttpError(400, 'Confirmá el borrado para continuar.');
      const rows = await sql`DELETE FROM yerbas WHERE user_id = ${session.id} RETURNING fotos`;
      for (const url of new Set(rows.flatMap(row => row.fotos || []))) await deletePhotoIfUnused(sql, url, session.id, true);
      return json(res, 200, { deleted: rows.length });
    }
    if (req.method === 'PUT') {
      if (id == null) throw new HttpError(400, 'Indicá qué yerba querés actualizar.');
      const [previous] = await sql`SELECT fotos FROM yerbas WHERE id = ${id} AND user_id = ${session.id}`;
      if (!previous) throw new HttpError(404, 'No se encontró esa yerba.');
      const record = validateYerba(await readJson(req));
      ensureOwnedPhotos(record.fotos, session.id, previous.fotos || []);
      const [row] = await sql`UPDATE yerbas SET
        estado = ${record.estado}, nombre = ${record.nombre}, marca = ${record.marca},
        tipo = ${record.tipo}, origen = ${record.origen}, molienda = ${record.molienda},
        modo = ${record.modo}, estacionamiento = ${record.estacionamiento}, gramos = ${record.gramos},
        precio = ${record.precio}, lugar = ${record.lugar}, fecha = ${record.fecha},
        puntajes = ${JSON.stringify(record.puntajes)}::jsonb, general = ${record.general},
        recompra = ${record.recompra}, favorita = ${record.favorita}, pros = ${record.pros},
        contras = ${record.contras}, notas = ${record.notas}, tags = ${record.tags},
        fotos = ${JSON.stringify(record.fotos)}::jsonb, actualizado = now()
        WHERE id = ${id} AND user_id = ${session.id} RETURNING *`;
      const retained = new Set(record.fotos);
      for (const url of new Set(previous.fotos || [])) {
        if (!retained.has(url)) await deletePhotoIfUnused(sql, url, session.id, true);
      }
      return json(res, 200, serializeYerba(row));
    }
    if (id != null) throw new HttpError(400, 'No se permite indicar un identificador al crear una yerba.');
    const record = validateYerba(await readJson(req));
    ensureOwnedPhotos(record.fotos, session.id);
    const [row] = await sql`INSERT INTO yerbas (
      estado, nombre, marca, tipo, origen, molienda, modo, estacionamiento, gramos,
      precio, lugar, fecha, puntajes, general, recompra, favorita, pros, contras,
      notas, tags, fotos, user_id
    ) VALUES (
      ${record.estado}, ${record.nombre}, ${record.marca}, ${record.tipo}, ${record.origen},
      ${record.molienda}, ${record.modo}, ${record.estacionamiento}, ${record.gramos},
      ${record.precio}, ${record.lugar}, ${record.fecha}, ${JSON.stringify(record.puntajes)}::jsonb,
      ${record.general}, ${record.recompra}, ${record.favorita}, ${record.pros}, ${record.contras},
      ${record.notas}, ${record.tags}, ${JSON.stringify(record.fotos)}::jsonb, ${session.id}
    ) RETURNING *`;
    return json(res, 201, serializeYerba(row));
  } catch (err) {
    return fail(res, err, 'api/yerbas');
  }
}
