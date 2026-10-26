export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(res, status, value) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(value));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, 'El cuerpo JSON no es válido.'); }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4.5 * 1024 * 1024) throw new HttpError(413, 'El archivo supera el tamaño permitido.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'El cuerpo JSON no es válido.'); }
}

export async function readBytes(req, maxBytes) {
  if (Buffer.isBuffer(req.body)) {
    if (req.body.length > maxBytes) throw new HttpError(413, 'La imagen supera el tamaño permitido.');
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'La imagen supera el tamaño permitido.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function fail(res, error) {
  if (error instanceof HttpError) return json(res, error.status, { error: error.message });
  console.error('Error interno en API Yerbario.');
  return json(res, 500, { error: 'Ocurrió un error interno. Intentá de nuevo más tarde.' });
}

export function methodNotAllowed(res, methods) {
  res.setHeader('Allow', methods.join(', '));
  return json(res, 405, { error: 'Método no permitido.' });
}
