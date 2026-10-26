import { json } from '../lib/http.js';

export default function handler(req, res) {
  return json(res, 404, { error: 'La ruta de la API no existe.' });
}
