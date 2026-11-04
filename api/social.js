import { db, ensureSchema, serializeYerba } from '../lib/db.js';
import { requireAuth } from '../lib/auth.js';
import { deletePhotoIfUnused } from '../lib/blob.js';
import { validateYerba } from '../lib/yerbas.js';
import { fail, HttpError, json, methodNotAllowed, readJson } from '../lib/http.js';

// Red social en una sola función (el plan gratuito de Vercel limita la cantidad de funciones).
// GET  /api/social?accion=feed|explorar&antes=ID     publicaciones (de quienes sigo / públicas)
// GET  /api/social?accion=perfil&usuario=X           cabecera del perfil, relación y estadísticas
// GET  /api/social?accion=yerbas&usuario=X           yerbas visibles de un usuario
// GET  /api/social?accion=yerba&id=N                 una publicación con sus comentarios
// GET  /api/social?accion=buscar&q=texto             usuarios
// GET  /api/social?accion=lista&usuario=X&tipo=seguidores|seguidos
// GET  /api/social?accion=notificaciones[&solo=contador]
// POST /api/social?accion=seguir|dejar|responder|quitar   { usuario[, aceptar] }
// POST /api/social?accion=like        { yerba, valor }
// POST /api/social?accion=comentar    { yerba, texto }
// POST /api/social?accion=borrar-comentario { id }
// POST /api/social?accion=guardar     { yerba }   copia la yerba de otro a mi lista "Quiero probar"
// POST /api/social?accion=perfil      { nombre, bio, avatar, privado, config }
// POST /api/social?accion=leer        marca las notificaciones como leídas

const POR_PAGINA = 20;
const CONFIG_DEFECTO = { estadisticas: true, quiero: true, seguidores: true };

const param = (req, name) => req.query?.[name] ?? new URL(req.url || '/', 'http://localhost').searchParams.get(name);

function idValido(value, label = 'El identificador') {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, `${label} no es válido.`);
  return id;
}

function texto(value, label, max) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${label} no es válido.`);
  const t = value.trim();
  if (t.length > max) throw new HttpError(400, `${label} puede tener hasta ${max} caracteres.`);
  return t;
}

function config(row) {
  return { ...CONFIG_DEFECTO, ...(row.perfil_config || {}) };
}

function usuarioPublico(row) {
  return { usuario: row.usuario, nombre: row.nombre || '', avatar: row.avatar || null };
}

// Usuario por nombre, con mi relación con él. Las cuentas sin confirmar no existen para los demás.
async function buscarPorUsuario(sql, viewer, usuario) {
  if (typeof usuario !== 'string' || !usuario.trim()) throw new HttpError(400, 'Indicá un usuario.');
  const [u] = await sql`SELECT u.*,
      (SELECT estado FROM seguidores WHERE seguidor_id = ${viewer} AND seguido_id = u.id) AS mi_estado,
      (SELECT estado FROM seguidores WHERE seguidor_id = u.id AND seguido_id = ${viewer}) AS su_estado
    FROM usuarios u
    WHERE lower(u.usuario) = ${usuario.trim().toLowerCase()}
      AND (u.id = ${viewer} OR u.email IS NULL OR u.email_verificado)`;
  if (!u) throw new HttpError(404, 'No encontramos ese usuario.');
  u.id = Number(u.id); // BIGINT llega como texto
  u.puede_ver = u.id === viewer || !u.privado || u.mi_estado === 'aceptado';
  return u;
}

function relacion(u, viewer) {
  if (Number(u.id) === viewer) return 'yo';
  return u.mi_estado === 'aceptado' ? 'siguiendo' : u.mi_estado === 'pendiente' ? 'pendiente' : 'ninguna';
}

// Una yerba de otro usuario, solo si el que mira puede verla.
async function yerbaVisible(sql, viewer, id) {
  const [y] = await sql`SELECT y.*, u.usuario AS autor_usuario, u.nombre AS autor_nombre, u.avatar AS autor_avatar,
      u.perfil_config AS autor_config,
      (SELECT count(*) FROM likes l WHERE l.yerba_id = y.id) AS n_likes,
      EXISTS (SELECT 1 FROM likes l WHERE l.yerba_id = y.id AND l.user_id = ${viewer}) AS me_gusta,
      (SELECT count(*) FROM comentarios c WHERE c.yerba_id = y.id) AS n_comentarios
    FROM yerbas y JOIN usuarios u ON u.id = y.user_id
    WHERE y.id = ${id}
      AND (y.user_id = ${viewer} OR NOT u.privado
           OR EXISTS (SELECT 1 FROM seguidores s WHERE s.seguidor_id = ${viewer} AND s.seguido_id = u.id AND s.estado = 'aceptado'))
      AND (y.estado = 'probada' OR y.user_id = ${viewer} OR COALESCE((u.perfil_config->>'quiero')::boolean, true))`;
  if (!y) throw new HttpError(404, 'No encontramos esa publicación o no tenés permiso para verla.');
  y.user_id = Number(y.user_id); // BIGINT llega como texto
  y.id = Number(y.id);
  return y;
}

async function notificar(sql, { para, actor, tipo, yerba = null, comentario = null }) {
  if (Number(para) === Number(actor)) return;
  await sql`INSERT INTO notificaciones (user_id, actor_id, tipo, yerba_id, comentario_id)
    VALUES (${para}, ${actor}, ${tipo}, ${yerba}, ${comentario})`;
}

function estadisticas(rows) {
  const probadas = rows.filter(y => y.estado === 'probada');
  const prom = vals => vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10 : null;
  const conGeneral = probadas.map(y => Number(y.general)).filter(v => v > 0);
  const mates = new Map();
  probadas.flatMap(y => y.mates || []).filter(m => m.puntaje > 0).forEach(m => {
    const k = m.material.trim().toLowerCase();
    if (!mates.has(k)) mates.set(k, { nombre: m.material.trim(), vals: [] });
    mates.get(k).vals.push(m.puntaje);
  });
  const mejorMate = [...mates.values()].map(m => ({ nombre: m.nombre, promedio: prom(m.vals) })).sort((a, b) => b.promedio - a.promedio)[0] || null;
  const marcas = new Map();
  probadas.filter(y => y.marca && y.general > 0).forEach(y => {
    if (!marcas.has(y.marca)) marcas.set(y.marca, []);
    marcas.get(y.marca).push(Number(y.general));
  });
  const mejorMarca = [...marcas].map(([nombre, vals]) => ({ nombre, promedio: prom(vals) })).sort((a, b) => b.promedio - a.promedio)[0] || null;
  const modos = new Map();
  probadas.filter(y => y.modo).forEach(y => modos.set(y.modo, (modos.get(y.modo) || 0) + 1));
  return {
    probadas: probadas.length,
    promedio: prom(conGeneral),
    primer_mate: prom(probadas.map(y => Number(y.primer_mate)).filter(v => v > 0)),
    favoritas: probadas.filter(y => y.favorita).length,
    mejor_mate: mejorMate,
    mejor_marca: mejorMarca,
    modo: [...modos].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
  };
}

const lecturas = {
  async feed(req, res, sql, me) {
    const antes = param(req, 'antes') ? idValido(param(req, 'antes')) : Number.MAX_SAFE_INTEGER;
    const rows = await sql`SELECT y.*, u.usuario AS autor_usuario, u.nombre AS autor_nombre, u.avatar AS autor_avatar,
        (SELECT count(*) FROM likes l WHERE l.yerba_id = y.id) AS n_likes,
        EXISTS (SELECT 1 FROM likes l WHERE l.yerba_id = y.id AND l.user_id = ${me}) AS me_gusta,
        (SELECT count(*) FROM comentarios c WHERE c.yerba_id = y.id) AS n_comentarios
      FROM yerbas y JOIN usuarios u ON u.id = y.user_id
      WHERE y.estado = 'probada' AND y.id < ${antes}
        AND (y.user_id = ${me} OR y.user_id IN (SELECT seguido_id FROM seguidores WHERE seguidor_id = ${me} AND estado = 'aceptado'))
      ORDER BY y.id DESC LIMIT ${POR_PAGINA}`;
    return json(res, 200, { publicaciones: rows.map(serializeYerba), fin: rows.length < POR_PAGINA });
  },

  async explorar(req, res, sql, me) {
    const antes = param(req, 'antes') ? idValido(param(req, 'antes')) : Number.MAX_SAFE_INTEGER;
    const rows = await sql`SELECT y.*, u.usuario AS autor_usuario, u.nombre AS autor_nombre, u.avatar AS autor_avatar,
        (SELECT count(*) FROM likes l WHERE l.yerba_id = y.id) AS n_likes,
        EXISTS (SELECT 1 FROM likes l WHERE l.yerba_id = y.id AND l.user_id = ${me}) AS me_gusta,
        (SELECT count(*) FROM comentarios c WHERE c.yerba_id = y.id) AS n_comentarios
      FROM yerbas y JOIN usuarios u ON u.id = y.user_id
      WHERE y.estado = 'probada' AND y.id < ${antes} AND NOT u.privado
        AND (u.email IS NULL OR u.email_verificado)
      ORDER BY y.id DESC LIMIT ${POR_PAGINA}`;
    return json(res, 200, { publicaciones: rows.map(serializeYerba), fin: rows.length < POR_PAGINA });
  },

  async perfil(req, res, sql, me) {
    const u = await buscarPorUsuario(sql, me, param(req, 'usuario'));
    const cfg = config(u);
    const [c] = await sql`SELECT
        (SELECT count(*) FROM yerbas WHERE user_id = ${u.id} AND estado = 'probada')::int AS yerbas,
        (SELECT count(*) FROM yerbas WHERE user_id = ${u.id} AND estado = 'quiero')::int AS quiero,
        (SELECT count(*) FROM seguidores WHERE seguido_id = ${u.id} AND estado = 'aceptado')::int AS seguidores,
        (SELECT count(*) FROM seguidores WHERE seguidor_id = ${u.id} AND estado = 'aceptado')::int AS seguidos`;
    const propio = u.id === me;
    let stats = null;
    if (u.puede_ver && (cfg.estadisticas || propio)) {
      stats = estadisticas(await sql`SELECT estado, marca, general, primer_mate, favorita, modo, mates FROM yerbas WHERE user_id = ${u.id}`);
    }
    return json(res, 200, {
      ...usuarioPublico(u),
      bio: u.bio || '',
      privado: u.privado,
      config: cfg,
      relacion: relacion(u, me),
      me_sigue: u.su_estado === 'aceptado',
      puede_ver: u.puede_ver,
      contadores: { ...c, quiero: (cfg.quiero || propio) ? c.quiero : null },
      estadisticas: stats,
    });
  },

  async yerbas(req, res, sql, me) {
    const u = await buscarPorUsuario(sql, me, param(req, 'usuario'));
    if (!u.puede_ver) throw new HttpError(403, 'Esta cuenta es privada. Seguila para ver sus yerbas.');
    const conQuiero = u.id === me || config(u).quiero;
    const rows = await sql`SELECT y.*,
        (SELECT count(*) FROM likes l WHERE l.yerba_id = y.id) AS n_likes,
        EXISTS (SELECT 1 FROM likes l WHERE l.yerba_id = y.id AND l.user_id = ${me}) AS me_gusta,
        (SELECT count(*) FROM comentarios c WHERE c.yerba_id = y.id) AS n_comentarios
      FROM yerbas y WHERE y.user_id = ${u.id} AND (y.estado = 'probada' OR ${conQuiero})
      ORDER BY y.id DESC LIMIT 300`;
    return json(res, 200, rows.map(serializeYerba));
  },

  async yerba(req, res, sql, me) {
    const y = await yerbaVisible(sql, me, idValido(param(req, 'id')));
    const comentarios = await sql`SELECT c.id, c.texto, c.creado, u.usuario, u.nombre, u.avatar, (c.user_id = ${me}) AS mio
      FROM comentarios c JOIN usuarios u ON u.id = c.user_id WHERE c.yerba_id = ${y.id} ORDER BY c.id LIMIT 300`;
    return json(res, 200, {
      ...serializeYerba(y),
      propia: y.user_id === me,
      lista_comentarios: comentarios.map(c => ({
        id: Number(c.id), texto: c.texto, creado: new Date(c.creado).getTime(), mio: c.mio,
        autor: usuarioPublico(c),
      })),
    });
  },

  async buscar(req, res, sql, me) {
    const q = String(param(req, 'q') || '').trim().toLowerCase().replace(/^@/, '').slice(0, 50);
    if (!q) return json(res, 200, []);
    const patron = `%${q.replace(/[\\%_]/g, c => '\\' + c)}%`;
    const rows = await sql`SELECT u.id, u.usuario, u.nombre, u.avatar, u.privado,
        (SELECT estado FROM seguidores WHERE seguidor_id = ${me} AND seguido_id = u.id) AS mi_estado
      FROM usuarios u
      WHERE (lower(u.usuario) LIKE ${patron} OR lower(u.nombre) LIKE ${patron})
        AND (u.email IS NULL OR u.email_verificado)
      ORDER BY (lower(u.usuario) = ${q}) DESC, (lower(u.usuario) LIKE ${q.replace(/[\\%_]/g, c => '\\' + c) + '%'}) DESC, u.usuario
      LIMIT 20`;
    return json(res, 200, rows.map(u => ({ ...usuarioPublico(u), privado: u.privado, relacion: relacion(u, me) })));
  },

  async lista(req, res, sql, me) {
    const u = await buscarPorUsuario(sql, me, param(req, 'usuario'));
    const tipo = param(req, 'tipo') === 'seguidos' ? 'seguidos' : 'seguidores';
    if (!u.puede_ver || (u.id !== me && !config(u).seguidores)) throw new HttpError(403, 'Este usuario no muestra esa lista.');
    const rows = tipo === 'seguidores'
      ? await sql`SELECT u.id, u.usuario, u.nombre, u.avatar,
          (SELECT estado FROM seguidores WHERE seguidor_id = ${me} AND seguido_id = u.id) AS mi_estado
        FROM seguidores s JOIN usuarios u ON u.id = s.seguidor_id
        WHERE s.seguido_id = ${u.id} AND s.estado = 'aceptado' ORDER BY s.creado DESC LIMIT 500`
      : await sql`SELECT u.id, u.usuario, u.nombre, u.avatar,
          (SELECT estado FROM seguidores WHERE seguidor_id = ${me} AND seguido_id = u.id) AS mi_estado
        FROM seguidores s JOIN usuarios u ON u.id = s.seguido_id
        WHERE s.seguidor_id = ${u.id} AND s.estado = 'aceptado' ORDER BY s.creado DESC LIMIT 500`;
    return json(res, 200, rows.map(r => ({ ...usuarioPublico(r), relacion: relacion(r, me) })));
  },

  async notificaciones(req, res, sql, me) {
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM notificaciones WHERE user_id = ${me} AND NOT leida`;
    if (param(req, 'solo') === 'contador') return json(res, 200, { no_leidas: n });
    const rows = await sql`SELECT n.id, n.tipo, n.leida, n.creado, n.yerba_id,
        a.id AS actor_id, a.usuario, a.nombre, a.avatar,
        y.nombre AS yerba_nombre, y.fotos->>0 AS yerba_foto, c.texto AS comentario,
        (SELECT estado FROM seguidores s WHERE s.seguidor_id = ${me} AND s.seguido_id = a.id) AS mi_estado
      FROM notificaciones n
      JOIN usuarios a ON a.id = n.actor_id
      LEFT JOIN yerbas y ON y.id = n.yerba_id
      LEFT JOIN comentarios c ON c.id = n.comentario_id
      WHERE n.user_id = ${me} ORDER BY n.id DESC LIMIT 60`;
    return json(res, 200, {
      no_leidas: n,
      items: rows.map(r => ({
        id: Number(r.id), tipo: r.tipo, leida: r.leida, creado: new Date(r.creado).getTime(),
        yerba: r.yerba_id ? { id: Number(r.yerba_id), nombre: r.yerba_nombre, foto: r.yerba_foto } : null,
        comentario: r.comentario || null,
        actor: { ...usuarioPublico(r), relacion: relacion({ id: Number(r.actor_id), mi_estado: r.mi_estado }, me) },
      })),
    });
  },
};

const acciones = {
  async seguir(req, res, sql, me, body) {
    const u = await buscarPorUsuario(sql, me, body.usuario);
    if (u.id === me) throw new HttpError(400, 'No podés seguirte a vos mismo.');
    const estado = u.privado ? 'pendiente' : 'aceptado';
    const [nuevo] = await sql`INSERT INTO seguidores (seguidor_id, seguido_id, estado) VALUES (${me}, ${u.id}, ${estado})
      ON CONFLICT DO NOTHING RETURNING estado`;
    if (nuevo) await notificar(sql, { para: u.id, actor: me, tipo: u.privado ? 'solicitud' : 'seguir' });
    const [actual] = await sql`SELECT estado FROM seguidores WHERE seguidor_id = ${me} AND seguido_id = ${u.id}`;
    return json(res, 200, { relacion: actual.estado === 'aceptado' ? 'siguiendo' : 'pendiente' });
  },

  async dejar(req, res, sql, me, body) {
    const u = await buscarPorUsuario(sql, me, body.usuario);
    await sql`DELETE FROM seguidores WHERE seguidor_id = ${me} AND seguido_id = ${u.id}`;
    await sql`DELETE FROM notificaciones WHERE user_id = ${u.id} AND actor_id = ${me} AND tipo IN ('seguir', 'solicitud')`;
    return json(res, 200, { relacion: 'ninguna' });
  },

  // Aceptar o rechazar una solicitud para seguirme.
  async responder(req, res, sql, me, body) {
    const u = await buscarPorUsuario(sql, me, body.usuario);
    if (body.aceptar === true) {
      const [ok] = await sql`UPDATE seguidores SET estado = 'aceptado'
        WHERE seguidor_id = ${u.id} AND seguido_id = ${me} AND estado = 'pendiente' RETURNING 1`;
      if (ok) {
        await sql`UPDATE notificaciones SET tipo = 'seguir' WHERE user_id = ${me} AND actor_id = ${u.id} AND tipo = 'solicitud'`;
        await notificar(sql, { para: u.id, actor: me, tipo: 'aceptada' });
      }
      return json(res, 200, { estado: 'aceptado' });
    }
    await sql`DELETE FROM seguidores WHERE seguidor_id = ${u.id} AND seguido_id = ${me} AND estado = 'pendiente'`;
    await sql`DELETE FROM notificaciones WHERE user_id = ${me} AND actor_id = ${u.id} AND tipo = 'solicitud'`;
    return json(res, 200, { estado: 'rechazado' });
  },

  // Quitar a alguien de mis seguidores.
  async quitar(req, res, sql, me, body) {
    const u = await buscarPorUsuario(sql, me, body.usuario);
    await sql`DELETE FROM seguidores WHERE seguidor_id = ${u.id} AND seguido_id = ${me}`;
    return json(res, 200, { ok: true });
  },

  async like(req, res, sql, me, body) {
    const y = await yerbaVisible(sql, me, idValido(body.yerba, 'La yerba'));
    if (body.valor === false) {
      await sql`DELETE FROM likes WHERE yerba_id = ${y.id} AND user_id = ${me}`;
      await sql`DELETE FROM notificaciones WHERE actor_id = ${me} AND yerba_id = ${y.id} AND tipo = 'like'`;
    } else {
      const [nuevo] = await sql`INSERT INTO likes (yerba_id, user_id) VALUES (${y.id}, ${me}) ON CONFLICT DO NOTHING RETURNING 1`;
      if (nuevo) await notificar(sql, { para: y.user_id, actor: me, tipo: 'like', yerba: y.id });
    }
    const [c] = await sql`SELECT count(*)::int AS n,
      EXISTS (SELECT 1 FROM likes WHERE yerba_id = ${y.id} AND user_id = ${me}) AS me_gusta
      FROM likes WHERE yerba_id = ${y.id}`;
    return json(res, 200, { likes: c.n, me_gusta: c.me_gusta });
  },

  async comentar(req, res, sql, me, body) {
    const y = await yerbaVisible(sql, me, idValido(body.yerba, 'La yerba'));
    const t = texto(body.texto, 'El comentario', 500);
    if (!t) throw new HttpError(400, 'Escribí algo para comentar.');
    const [c] = await sql`INSERT INTO comentarios (yerba_id, user_id, texto) VALUES (${y.id}, ${me}, ${t}) RETURNING id, creado`;
    await notificar(sql, { para: y.user_id, actor: me, tipo: 'comentario', yerba: y.id, comentario: c.id });
    const [u] = await sql`SELECT usuario, nombre, avatar FROM usuarios WHERE id = ${me}`;
    return json(res, 201, { id: Number(c.id), texto: t, creado: new Date(c.creado).getTime(), mio: true, autor: usuarioPublico(u) });
  },

  // Borra un comentario propio, o cualquiera en una yerba propia.
  async 'borrar-comentario'(req, res, sql, me, body) {
    const [c] = await sql`DELETE FROM comentarios c USING yerbas y
      WHERE c.id = ${idValido(body.id, 'El comentario')} AND y.id = c.yerba_id AND (c.user_id = ${me} OR y.user_id = ${me})
      RETURNING c.id`;
    if (!c) throw new HttpError(404, 'No encontramos ese comentario o no podés borrarlo.');
    return json(res, 200, { ok: true });
  },

  // Copia la yerba de otro a mi lista "Quiero probar" (sin fotos: son del otro usuario).
  async guardar(req, res, sql, me, body) {
    const y = await yerbaVisible(sql, me, idValido(body.yerba, 'La yerba'));
    if (y.user_id === me) throw new HttpError(400, 'Esta yerba ya es tuya.');
    const [ya] = await sql`SELECT 1 FROM yerbas WHERE user_id = ${me} AND lower(nombre) = lower(${y.nombre}) AND lower(marca) = lower(${y.marca})`;
    if (ya) throw new HttpError(409, 'Ya tenés esa yerba en tu colección.');
    const r = validateYerba({
      estado: 'quiero', nombre: y.nombre, marca: y.marca, tipo: y.tipo, gramos: y.gramos,
      notas: `Vista en el perfil de @${y.autor_usuario}.`,
    });
    await sql`INSERT INTO yerbas (estado, nombre, marca, tipo, gramos, notas, user_id)
      VALUES (${r.estado}, ${r.nombre}, ${r.marca}, ${r.tipo}, ${r.gramos}, ${r.notas}, ${me})`;
    return json(res, 201, { ok: true });
  },

  async perfil(req, res, sql, me, body) {
    const [actual] = await sql`SELECT avatar, privado, perfil_config FROM usuarios WHERE id = ${me}`;
    const nombre = texto(body.nombre, 'El nombre', 50);
    const bio = texto(body.bio, 'La biografía', 300);
    if (typeof body.privado !== 'boolean') throw new HttpError(400, 'Indicá si la cuenta es privada.');
    const cfg = { ...config(actual) };
    for (const k of Object.keys(CONFIG_DEFECTO)) if (typeof body.config?.[k] === 'boolean') cfg[k] = body.config[k];
    let avatar = body.avatar ?? null;
    if (avatar !== null) {
      let ok = false;
      try {
        const u = new URL(avatar);
        ok = u.protocol === 'https:' && u.hostname.endsWith('.public.blob.vercel-storage.com') && u.pathname.startsWith(`/yerbario/${me}/`);
        avatar = u.href;
      } catch { /* ok queda en false */ }
      if (!ok && avatar !== actual.avatar) throw new HttpError(400, 'La foto de perfil no es válida.');
    }
    await sql`UPDATE usuarios SET nombre = ${nombre}, bio = ${bio}, avatar = ${avatar}, privado = ${body.privado},
      perfil_config = ${JSON.stringify(cfg)}::jsonb WHERE id = ${me}`;
    // Al pasar a pública, las solicitudes pendientes quedan aceptadas.
    if (actual.privado && !body.privado) {
      await sql`UPDATE seguidores SET estado = 'aceptado' WHERE seguido_id = ${me} AND estado = 'pendiente'`;
      await sql`UPDATE notificaciones SET tipo = 'seguir' WHERE user_id = ${me} AND tipo = 'solicitud'`;
    }
    if (actual.avatar && actual.avatar !== avatar) {
      try { await deletePhotoIfUnused(sql, actual.avatar, me, true); }
      catch (err) { console.error('[api/social] error al borrar la foto de perfil anterior', err.message); }
    }
    return json(res, 200, { ok: true });
  },

  async leer(req, res, sql, me) {
    await sql`UPDATE notificaciones SET leida = true WHERE user_id = ${me} AND NOT leida`;
    return json(res, 200, { ok: true });
  },
};

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);
  const session = requireAuth(req, res);
  if (!session) return;
  try {
    const accion = param(req, 'accion') ?? '';
    const tabla = req.method === 'GET' ? lecturas : acciones;
    if (!Object.hasOwn(tabla, accion)) throw new HttpError(404, 'Esa acción no existe.');
    await ensureSchema();
    const sql = db();
    const body = req.method === 'POST' ? await readJson(req) : null;
    if (req.method === 'POST' && (!body || typeof body !== 'object' || Array.isArray(body))) throw new HttpError(400, 'La solicitud no es válida.');
    return await tabla[accion](req, res, sql, Number(session.id), body);
  } catch (err) {
    return fail(res, err, 'api/social');
  }
}
