'use strict';

/* =========================================================
   Yerbario · red social
   Inicio (feed), perfiles, búsqueda, notificaciones y publicaciones.
   Usa las utilidades de app.js ($, $$, api, esc, stars, toast, state…).
   ========================================================= */

const social = {
  modoFeed: 'feed',     // 'feed' (siguiendo) o 'explorar' (descubrir)
  feed: [],
  feedFin: false,
  perfil: null,         // perfil abierto
  perfilYerbas: [],
  perfilTab: 'yerbas',
  post: null,           // publicación abierta en el diálogo
  avatarNuevo: undefined, // al editar perfil: undefined = sin cambios, null = quitar, string = URL
  pollId: null,
};

/* ---------- Utilidades ---------- */
function hace(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 7 * 86400) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function avatarHTML(u, cls = '') {
  if (u?.avatar) return `<img class="avatar ${cls}" src="${esc(u.avatar)}" alt="">`;
  const letra = (u?.nombre || u?.usuario || '?').trim().charAt(0).toUpperCase() || '?';
  return `<span class="avatar avatar-ph ${cls}" aria-hidden="true">${esc(letra)}</span>`;
}

const urlPerfil = usuario => `#/u/${encodeURIComponent(usuario)}`;
const esMio = usuario => state.cuenta && usuario?.toLowerCase() === state.cuenta.usuario.toLowerCase();

function botonSeguir(u) {
  if (u.relacion === 'yo') return '';
  const t = { siguiendo: ['Siguiendo', 'ghost'], pendiente: ['Solicitado', 'ghost'], ninguna: ['Seguir', 'primary'] }[u.relacion] || ['Seguir', 'primary'];
  return `<button type="button" class="btn ${t[1]} sm" data-act="seguir" data-usuario="${esc(u.usuario)}" data-relacion="${u.relacion}">${t[0]}</button>`;
}

// Sigue / deja de seguir / cancela la solicitud. Devuelve la relación nueva.
async function alternarSeguir(usuario, relacion) {
  if (relacion === 'siguiendo' && !(await confirmar(`¿Dejar de seguir a @${usuario}?`, 'Vas a dejar de ver sus yerbas en tu inicio.', 'Dejar de seguir'))) return relacion;
  const accion = relacion === 'ninguna' ? 'seguir' : 'dejar';
  const r = await api(`/api/social?accion=${accion}`, { method: 'POST', body: { usuario } });
  if (r.relacion === 'pendiente') toast('Solicitud enviada');
  return r.relacion;
}

// Botones "Seguir" en cualquier lista: se actualizan en el lugar.
async function manejarBotonSeguir(b) {
  b.disabled = true;
  try {
    const nueva = await alternarSeguir(b.dataset.usuario, b.dataset.relacion);
    const tmp = document.createElement('div');
    tmp.innerHTML = botonSeguir({ usuario: b.dataset.usuario, relacion: nueva });
    b.replaceWith(tmp.firstElementChild || '');
    if (social.perfil && social.perfil.usuario === b.dataset.usuario) cargarPerfil(social.perfil.usuario);
  } catch (error) {
    toast(error.mensaje || error.message, { error: true });
    b.disabled = false;
  }
}

function filaUsuario(u, extra = '') {
  return `<div class="user-row">
    <a href="${urlPerfil(u.usuario)}" class="user-link">${avatarHTML(u)}
      <span><b>${esc(u.usuario)}</b>${u.nombre ? `<small>${esc(u.nombre)}</small>` : ''}</span></a>
    ${extra || botonSeguir(u)}
  </div>`;
}

/* ---------- Router: #/inicio, #/coleccion, #/stats, #/buscar, #/notificaciones, #/u/usuario ---------- */
function rutaActual() {
  const [v, p] = location.hash.replace(/^#\/?/, '').split('/');
  return { v: v || 'inicio', p: p ? decodeURIComponent(p) : '' };
}

function navegar() {
  if (!state.cuenta) return;
  const { v, p } = rutaActual();
  document.querySelectorAll('dialog[open]').forEach(d => { if (['dlg-post', 'dlg-lista', 'dlg-detail', 'dlg-compare'].includes(d.id)) d.close(); });
  if (v === 'u') {
    cambiarVista('perfil');
    cargarPerfil(p || state.cuenta.usuario);
  } else if (v === 'notificaciones') {
    cambiarVista('notifs');
    cargarNotificaciones();
  } else if (['coleccion', 'stats', 'buscar'].includes(v)) {
    cambiarVista(v);
    if (v === 'buscar') setTimeout(() => $('#buscar-q').focus(), 0);
  } else {
    cambiarVista('inicio');
    cargarFeed(true);
  }
}
window.addEventListener('hashchange', navegar);

// app.js la llama cada vez que se cargan los datos de la cuenta (al entrar o editar el perfil).
window.alCargarCuenta = () => {
  const c = state.cuenta;
  const btn = $('#btn-perfil');
  btn.href = urlPerfil(c.usuario);
  btn.innerHTML = avatarHTML(c, 'sm');
  pintarContador(c.no_leidas || 0);
  if (!social.pollId) social.pollId = setInterval(actualizarContador, 60000);
  // Si cambió la cuenta (cerró sesión y entró otra), se descarta lo que había cargado.
  if (social.cuentaVista !== c.usuario) {
    social.cuentaVista = c.usuario;
    Object.assign(social, { feed: [], perfil: null, perfilYerbas: [], post: null });
    navegar();
  }
};

/* ---------- Notificaciones ---------- */
function pintarContador(n) {
  const b = $('#notif-badge');
  b.textContent = n > 99 ? '99+' : String(n);
  b.hidden = !n;
}

async function actualizarContador() {
  if (!state.cuenta || document.hidden) return;
  try { pintarContador((await api('/api/social?accion=notificaciones&solo=contador')).no_leidas); }
  catch { /* sin conexión: se reintenta en el próximo ciclo */ }
}

function textoNotificacion(n) {
  const quien = `<a href="${urlPerfil(n.actor.usuario)}"><b>${esc(n.actor.usuario)}</b></a>`;
  const yerba = n.yerba ? `<b>${esc(n.yerba.nombre)}</b>` : 'tu yerba';
  return {
    seguir: `${quien} empezó a seguirte.`,
    solicitud: `${quien} quiere seguirte.`,
    aceptada: `${quien} aceptó tu solicitud.`,
    like: `A ${quien} le gustó ${yerba}.`,
    comentario: `${quien} comentó ${yerba}: “${esc(n.comentario || '')}”`,
  }[n.tipo] || '';
}

async function cargarNotificaciones() {
  const list = $('#notifs-list');
  list.innerHTML = '<p class="loading">Cargando…</p>';
  try {
    const r = await api('/api/social?accion=notificaciones');
    if (!r.items.length) {
      list.innerHTML = '<div class="empty-box"><h2>Sin novedades</h2><p>Acá vas a ver cuando alguien te siga, le guste o comente una de tus yerbas.</p></div>';
    } else {
      list.innerHTML = r.items.map(n => `
        <div class="notif ${n.leida ? '' : 'nueva'}" data-yerba="${n.yerba?.id || ''}">
          <a href="${urlPerfil(n.actor.usuario)}">${avatarHTML(n.actor)}</a>
          <p>${textoNotificacion(n)} <small class="muted">${hace(n.creado)}</small></p>
          ${n.tipo === 'solicitud'
            ? `<div class="notif-btns"><button class="btn primary sm" data-act="aceptar" data-usuario="${esc(n.actor.usuario)}">Aceptar</button><button class="btn ghost sm" data-act="rechazar" data-usuario="${esc(n.actor.usuario)}">Rechazar</button></div>`
            : n.yerba
              ? `<button type="button" class="notif-thumb" data-act="abrir-post" data-id="${n.yerba.id}" aria-label="Ver la publicación">${n.yerba.foto ? `<img src="${esc(n.yerba.foto)}" alt="">` : '🧉'}</button>`
              : (['seguir', 'aceptada'].includes(n.tipo) ? botonSeguir(n.actor) : '')}
        </div>`).join('');
    }
    if (r.no_leidas) {
      await api('/api/social?accion=leer', { method: 'POST', body: {} });
      pintarContador(0);
    }
  } catch (error) {
    list.innerHTML = `<p class="muted">${esc(error.mensaje || error.message)}</p>`;
  }
}

$('#notifs-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'abrir-post') return abrirPost(+b.dataset.id);
  if (b.dataset.act === 'seguir') return manejarBotonSeguir(b);
  if (b.dataset.act === 'aceptar' || b.dataset.act === 'rechazar') {
    b.parentElement.querySelectorAll('button').forEach(x => { x.disabled = true; });
    try {
      await api('/api/social?accion=responder', { method: 'POST', body: { usuario: b.dataset.usuario, aceptar: b.dataset.act === 'aceptar' } });
      b.parentElement.outerHTML = `<span class="muted small">${b.dataset.act === 'aceptar' ? 'Aceptada ✔' : 'Rechazada'}</span>`;
    } catch (error) {
      toast(error.mensaje || error.message, { error: true });
    }
  }
});

/* ---------- Publicaciones (tarjetas del inicio) ---------- */
function tarjetaPost(p) {
  const foto = p.fotos?.[0];
  const quiero = p.estado === 'quiero';
  return `<article class="post" data-id="${p.id}">
    <header class="post-head">
      <a href="${urlPerfil(p.autor.usuario)}" class="user-link">${avatarHTML(p.autor)}<span><b>${esc(p.autor.usuario)}</b><small>${hace(p.creado)}</small></span></a>
    </header>
    <button type="button" class="post-photo${foto ? '' : ' sin-foto'}" data-act="abrir" aria-label="Ver ${esc(p.nombre)}">
      ${foto ? `<img src="${esc(foto)}" alt="Foto de ${esc(p.nombre)}" loading="lazy">` : `<div class="ph"><span>🧉</span><b>${esc(p.nombre)}</b></div>`}
      ${p.fotos?.length > 1 ? `<span class="photo-count">📷 ${p.fotos.length}</span>` : ''}
    </button>
    ${accionesPost(p)}
    <div class="post-body">
      <p class="post-likes" data-likes>${p.likes} me gusta</p>
      <p class="post-title"><b>${esc(p.nombre)}</b>${p.marca ? ` · <span class="muted">${esc(p.marca)}</span>` : ''}</p>
      ${quiero ? '' : `<div class="post-rate">${stars(p.general, 'sm')} <b>${p.general ? fmtRate(p.general) : '—'}</b>${p.primer_mate ? `<span class="chip">1.er mate ${fmtRate(p.primer_mate)} ★</span>` : ''}${p.modo ? `<span class="chip">${esc(p.modo)}</span>` : ''}</div>`}
      ${p.notas ? `<p class="post-notas"><b>${esc(p.autor.usuario)}</b> ${esc(p.notas)}</p>` : ''}
      ${p.comentarios ? `<button type="button" class="link-btn muted-link" data-act="abrir">Ver ${p.comentarios === 1 ? 'el comentario' : `los ${p.comentarios} comentarios`}</button>` : ''}
    </div>
  </article>`;
}

function accionesPost(p) {
  return `<div class="post-actions">
    <button type="button" class="pa-btn like ${p.me_gusta ? 'on' : ''}" data-act="like" aria-pressed="${p.me_gusta}" aria-label="Me gusta">${p.me_gusta ? '♥' : '♡'}</button>
    <button type="button" class="pa-btn" data-act="comentar" aria-label="Comentar">💬</button>
    ${esMio(p.autor?.usuario) ? '' : '<button type="button" class="pa-btn guardar" data-act="guardar" title="Guardar en mi lista Quiero probar" aria-label="Guardar en mi lista">🔖</button>'}
  </div>`;
}

async function cargarFeed(reset) {
  const box = $('#feed');
  if (reset) { social.feed = []; social.feedFin = false; box.innerHTML = '<p class="loading">Cargando…</p>'; }
  const antes = social.feed.at(-1)?.id;
  try {
    const r = await api(`/api/social?accion=${social.modoFeed}${antes ? `&antes=${antes}` : ''}`);
    social.feed.push(...r.publicaciones);
    social.feedFin = r.fin;
    if (!social.feed.length) {
      box.innerHTML = social.modoFeed === 'feed'
        ? `<div class="empty-box"><div class="empty-art">🧉</div><h2>Tu inicio está vacío</h2>
            <p>Seguí a otros materos para ver sus yerbas acá, o cargá la tuya.</p>
            <div class="empty-actions"><a class="btn primary" href="#/buscar">Buscar personas</a><button class="btn ghost" data-act="ir-explorar">Descubrir yerbas</button></div></div>`
        : '<div class="empty-box"><h2>Todavía no hay publicaciones públicas</h2><p>¡Sé el primero en compartir una yerba!</p></div>';
    } else {
      box.innerHTML = social.feed.map(tarjetaPost).join('');
    }
    $('#feed-mas').hidden = social.feedFin;
  } catch (error) {
    box.innerHTML = `<p class="muted">${esc(error.mensaje || error.message)}</p>`;
  }
}

// Actualiza el corazón y el contador en todas las vistas abiertas.
function pintarLike(id, likes, meGusta) {
  for (const lista of [social.feed, social.perfilYerbas, state.yerbas]) {
    const y = lista.find(x => x.id === id);
    if (y) { y.likes = likes; y.me_gusta = meGusta; }
  }
  if (social.post?.id === id) { social.post.likes = likes; social.post.me_gusta = meGusta; }
  $$(`.post[data-id="${id}"], #post-body[data-id="${id}"]`).forEach(el => {
    const b = $('[data-act="like"]', el);
    if (b) { b.classList.toggle('on', meGusta); b.textContent = meGusta ? '♥' : '♡'; b.setAttribute('aria-pressed', meGusta); }
    const n = $('[data-likes]', el);
    if (n) n.textContent = `${likes} me gusta`;
  });
}

async function darLike(id, actual) {
  pintarLike(id, (actual.likes || 0) + (actual.me_gusta ? -1 : 1), !actual.me_gusta);
  try {
    const r = await api('/api/social?accion=like', { method: 'POST', body: { yerba: id, valor: !actual.me_gusta } });
    pintarLike(id, r.likes, r.me_gusta);
  } catch (error) {
    pintarLike(id, actual.likes, actual.me_gusta);
    toast(error.mensaje || error.message, { error: true });
  }
}

async function guardarEnLista(id) {
  try {
    await api('/api/social?accion=guardar', { method: 'POST', body: { yerba: id } });
    toast('Guardada en tu lista "Quiero probar" 🔖');
    recargar().catch(() => {});
  } catch (error) {
    toast(error.mensaje || error.message, { error: true });
  }
}

$('#feed').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'ir-explorar') { $('input[name="feed-modo"][value="explorar"]').click(); return; }
  const id = +b.closest('.post')?.dataset.id;
  const p = social.feed.find(x => x.id === id);
  if (!p) return;
  if (b.dataset.act === 'like') darLike(id, { ...p });
  if (b.dataset.act === 'abrir') abrirPost(id);
  if (b.dataset.act === 'comentar') abrirPost(id, { comentar: true });
  if (b.dataset.act === 'guardar') guardarEnLista(id);
});
$('#feed-mas').addEventListener('click', () => cargarFeed(false));
$$('input[name="feed-modo"]').forEach(r => r.addEventListener('change', () => { social.modoFeed = r.value; cargarFeed(true); }));

/* ---------- Diálogo de publicación ---------- */
async function abrirPost(id, { comentar = false } = {}) {
  const dlg = $('#dlg-post');
  const body = $('#post-body');
  body.dataset.id = id;
  body.innerHTML = '<p class="loading">Cargando…</p>';
  if (!dlg.open) dlg.showModal();
  try {
    social.post = await api(`/api/social?accion=yerba&id=${id}`);
    body.innerHTML = postHTML(social.post);
    if (comentar) $('#post-body .comment-form textarea')?.focus();
  } catch (error) {
    body.innerHTML = `<header class="dlg-head"><span></span><button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button></header><p class="muted" style="padding:24px">${esc(error.mensaje || error.message)}</p>`;
  }
}
window.abrirPost = abrirPost;

function comentarioHTML(c, puedeBorrar) {
  return `<li class="comment" data-id="${c.id}">
    <a href="${urlPerfil(c.autor.usuario)}">${avatarHTML(c.autor, 'sm')}</a>
    <div><p><a href="${urlPerfil(c.autor.usuario)}"><b>${esc(c.autor.usuario)}</b></a> ${esc(c.texto)}</p><small class="muted">${hace(c.creado)}</small></div>
    ${puedeBorrar || c.mio ? '<button type="button" class="comment-x" data-act="borrar-com" aria-label="Borrar comentario">✕</button>' : ''}
  </li>`;
}

function postHTML(y) {
  const fotos = y.fotos || [];
  const quiero = y.estado === 'quiero';
  const p = y.puntajes || {};
  const kg = precioKg(y);
  const hechos = [['Tipo', y.tipo], ['Cómo la tomé', y.modo], ['Contenido', y.gramos ? `${y.gramos} g` : ''],
    ['Precio', y.precio != null ? money(y.precio) : ''], ['Precio por kg', kg ? money(kg) : ''], ['Fecha', y.fecha ? fmtFecha(y.fecha) : '']].filter(h => h[1]);
  const filaRo = (label, v) => `<li><span>${label}</span><span>${stars(v, 'sm')} <span class="v">${v ? fmtRate(v) : '—'}</span></span></li>`;
  return `
    <header class="dlg-head">
      <a href="${urlPerfil(y.autor.usuario)}" class="user-link">${avatarHTML(y.autor)}<span><b>${esc(y.autor.usuario)}</b><small>${hace(y.creado)}</small></span></a>
      <button type="button" class="icon-btn" data-close aria-label="Cerrar">✕</button>
    </header>
    <div class="detail dlg-body" style="padding:0">
      <div class="detail-media">
        ${fotos.length
          ? `<a id="post-main-link" class="detail-main" href="${esc(fotos[0])}" target="_blank" rel="noopener"><img id="post-main-img" src="${esc(fotos[0])}" alt="Foto de ${esc(y.nombre)}"></a>
             ${fotos.length > 1 ? `<div class="detail-thumbs">${fotos.map((u, i) => `<button type="button" data-thumb="${i}" class="${i === 0 ? 'on' : ''}" aria-label="Ver foto ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}`
          : '<div class="detail-main"><div class="ph" aria-hidden="true"><span>🧉</span></div></div>'}
      </div>
      <div class="detail-info">
        <div>
          <p class="detail-brand">${esc(y.marca || 'Sin marca')}</p>
          <h2>${esc(y.nombre)}</h2>
          ${quiero ? '<div class="badges"><span class="badge wish">🛒 Quiere probarla</span></div>'
            : `<div class="detail-rate">${stars(y.general, 'lg')}<span class="big">${y.general ? fmtRate(y.general) : '—'}</span></div>`}
        </div>
        ${hechos.length ? `<dl class="facts">${hechos.map(h => `<div><dt>${h[0]}</dt><dd>${esc(h[1])}</dd></div>`).join('')}</dl>` : ''}
        ${!quiero ? `<div class="detail-block"><h4>Valoración</h4>
          <ul class="crit-ro">${filaRo('Primer mate', y.primer_mate)}${CRITERIOS.filter(c => p[c.key] > 0).map(c => filaRo(c.label, p[c.key])).join('')}</ul></div>` : ''}
        ${!quiero && y.mates?.length ? `<div class="detail-block"><h4>Mates en los que la tomó</h4>${matesHTML(y.mates)}</div>` : ''}
        ${y.notas ? `<div class="notes"><h4>Notas</h4><p>${esc(y.notas)}</p></div>` : ''}
        ${accionesPost(y)}
        <p class="post-likes" data-likes>${y.likes} me gusta</p>
        ${y.propia ? '<div class="detail-actions"><button type="button" class="btn ghost sm" data-act="editar">✎ Editar mi yerba</button></div>' : ''}
        <div class="detail-block">
          <h4>Comentarios</h4>
          <ul class="comments">${y.lista_comentarios.map(c => comentarioHTML(c, y.propia)).join('') || '<li class="muted small sin-com">Todavía no hay comentarios.</li>'}</ul>
          <form class="comment-form">
            ${avatarHTML(state.cuenta, 'sm')}
            <textarea rows="1" maxlength="500" placeholder="Agregá un comentario…" aria-label="Comentario"></textarea>
            <button type="submit" class="btn primary sm">Publicar</button>
          </form>
        </div>
      </div>
    </div>`;
}

$('#post-body').addEventListener('click', async e => {
  const y = social.post;
  const th = e.target.closest('[data-thumb]');
  if (th && y) {
    const url = y.fotos[+th.dataset.thumb];
    $('#post-main-img').src = url;
    $('#post-main-link').href = url;
    $$('#post-body .detail-thumbs button').forEach(b => b.classList.toggle('on', b === th));
    return;
  }
  const b = e.target.closest('[data-act]');
  if (!b || !y) return;
  if (b.dataset.act === 'like') darLike(y.id, { ...y });
  if (b.dataset.act === 'comentar') $('#post-body .comment-form textarea').focus();
  if (b.dataset.act === 'guardar') guardarEnLista(y.id);
  if (b.dataset.act === 'editar') { $('#dlg-post').close(); abrirForm(y.id); }
  if (b.dataset.act === 'borrar-com') {
    const li = b.closest('.comment');
    try {
      await api('/api/social?accion=borrar-comentario', { method: 'POST', body: { id: +li.dataset.id } });
      li.remove();
      y.comentarios = Math.max(0, y.comentarios - 1);
      actualizarComentariosEnListas(y.id, y.comentarios);
    } catch (error) { toast(error.mensaje || error.message, { error: true }); }
  }
});

$('#post-body').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target.closest('.comment-form');
  const y = social.post;
  const ta = $('textarea', form);
  const texto = ta.value.trim();
  if (!texto || !y) return;
  const boton = $('button', form);
  boton.disabled = true;
  try {
    const c = await api('/api/social?accion=comentar', { method: 'POST', body: { yerba: y.id, texto } });
    $('#post-body .sin-com')?.remove();
    $('#post-body .comments').insertAdjacentHTML('beforeend', comentarioHTML(c, y.propia));
    ta.value = '';
    y.comentarios += 1;
    actualizarComentariosEnListas(y.id, y.comentarios);
  } catch (error) {
    toast(error.mensaje || error.message, { error: true });
  } finally {
    boton.disabled = false;
  }
});
// Enter publica; Shift+Enter hace un salto de línea.
$('#post-body').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && e.target.matches('.comment-form textarea')) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

function actualizarComentariosEnListas(id, n) {
  for (const lista of [social.feed, social.perfilYerbas, state.yerbas]) {
    const y = lista.find(x => x.id === id);
    if (y) y.comentarios = n;
  }
}

$('#dlg-post').addEventListener('close', () => {
  // Al cerrar, refresca la vista para mostrar los contadores nuevos.
  if (state.view === 'inicio') $('#feed').innerHTML = social.feed.map(tarjetaPost).join('') || $('#feed').innerHTML;
  if (state.view === 'perfil' && social.perfil) renderPerfil();
});

/* ---------- Perfil ---------- */
async function cargarPerfil(usuario) {
  const body = $('#perfil-body');
  if (social.perfil?.usuario?.toLowerCase() !== usuario.toLowerCase()) {
    body.innerHTML = '<p class="loading">Cargando perfil…</p>';
    social.perfilTab = 'yerbas';
  }
  try {
    const perfil = await api(`/api/social?accion=perfil&usuario=${encodeURIComponent(usuario)}`);
    social.perfil = perfil;
    social.perfilYerbas = perfil.puede_ver ? await api(`/api/social?accion=yerbas&usuario=${encodeURIComponent(perfil.usuario)}`) : [];
    renderPerfil();
  } catch (error) {
    social.perfil = null;
    body.innerHTML = `<div class="empty-box"><h2>No encontramos ese perfil</h2><p>${esc(error.mensaje || error.message)}</p></div>`;
  }
}

function renderPerfil() {
  const p = social.perfil;
  const propio = p.relacion === 'yo';
  const c = p.contadores;
  const verListas = p.puede_ver && (propio || p.config.seguidores);
  const tabs = [['yerbas', `Yerbas`]];
  if (p.puede_ver && c.quiero != null) tabs.push(['quiero', 'Quiero probar']);
  if (p.estadisticas) tabs.push(['stats', 'Estadísticas']);
  if (!tabs.some(t => t[0] === social.perfilTab)) social.perfilTab = 'yerbas';

  const contador = (n, label, tipo) => verListas && tipo
    ? `<button type="button" class="pc" data-act="lista" data-tipo="${tipo}"><b>${n}</b> ${label}</button>`
    : `<span class="pc"><b>${n}</b> ${label}</span>`;

  $('#perfil-body').innerHTML = `
    <header class="perfil-head">
      <div class="perfil-avatar">${avatarHTML(p, 'xl')}</div>
      <div class="perfil-info">
        <div class="perfil-top">
          <h2>${esc(p.usuario)}${p.privado ? ' <span class="lock" title="Cuenta privada">🔒</span>' : ''}</h2>
          ${propio
            ? '<button type="button" class="btn ghost sm" data-act="editar-perfil">Editar perfil</button><a class="btn ghost sm" href="#/coleccion">Mi colección</a>'
            : `${botonSeguir(p)}${p.me_sigue ? '<span class="chip">Te sigue</span>' : ''}`}
        </div>
        <div class="perfil-counts">
          ${contador(c.yerbas, c.yerbas === 1 ? 'yerba' : 'yerbas')}
          ${contador(c.seguidores, c.seguidores === 1 ? 'seguidor' : 'seguidores', 'seguidores')}
          ${contador(c.seguidos, c.seguidos === 1 ? 'seguido' : 'seguidos', 'seguidos')}
        </div>
        ${p.nombre ? `<p class="perfil-nombre">${esc(p.nombre)}</p>` : ''}
        ${p.bio ? `<p class="perfil-bio">${esc(p.bio)}</p>` : (propio ? '<p class="perfil-bio muted">Todavía no escribiste una biografía. Tocá "Editar perfil".</p>' : '')}
      </div>
    </header>
    ${p.puede_ver ? `
      <nav class="perfil-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${k}" class="${social.perfilTab === k ? 'on' : ''}" aria-selected="${social.perfilTab === k}">${l}</button>`).join('')}</nav>
      <div class="perfil-contenido">${contenidoPerfil(p, propio)}</div>`
      : `<div class="empty-box privado-box"><div class="empty-art">🔒</div><h2>Esta cuenta es privada</h2><p>${p.relacion === 'pendiente' ? 'Ya enviaste la solicitud. Cuando la acepte vas a ver sus yerbas.' : 'Seguila para ver sus yerbas y estadísticas.'}</p></div>`}`;
}

function contenidoPerfil(p, propio) {
  if (social.perfilTab === 'stats') return statsPerfilHTML(p.estadisticas);
  const estado = social.perfilTab === 'quiero' ? 'quiero' : 'probada';
  const lista = social.perfilYerbas.filter(y => y.estado === estado);
  if (!lista.length) {
    return `<div class="empty-box"><p>${estado === 'quiero' ? 'No hay yerbas en la lista de deseos.' : (propio ? 'Todavía no cargaste yerbas probadas.' : 'Todavía no compartió yerbas.')}</p>
      ${propio && estado === 'probada' ? '<button class="btn primary" data-act="nueva">+ Cargar una yerba</button>' : ''}</div>`;
  }
  return `<div class="pgrid">${lista.map(y => `
    <button type="button" class="ptile" data-id="${y.id}" aria-label="${esc(y.nombre)}">
      ${y.fotos?.[0] ? `<img src="${esc(y.fotos[0])}" alt="" loading="lazy">` : `<span class="ptile-ph"><span>🧉</span><b>${esc(y.nombre)}</b></span>`}
      <span class="ptile-over"><span>♥ ${y.likes}</span><span>💬 ${y.comentarios}</span>${y.general ? `<span>★ ${fmtRate(y.general)}</span>` : ''}</span>
    </button>`).join('')}</div>`;
}

function statsPerfilHTML(s) {
  if (!s) return '<p class="muted">Este usuario no muestra sus estadísticas.</p>';
  const kpi = (n, l) => `<div class="kpi"><span class="kpi-n">${n}</span><span class="kpi-l">${l}</span></div>`;
  return `<div class="kpis">
    ${kpi(s.probadas, 'yerbas probadas')}
    ${kpi(s.promedio != null ? fmtRate(s.promedio) + ' ★' : '—', 'puntaje promedio')}
    ${kpi(s.primer_mate != null ? fmtRate(s.primer_mate) + ' ★' : '—', 'primer mate promedio')}
    ${kpi(s.favoritas, 'favoritas')}
    ${kpi(s.mejor_marca ? esc(s.mejor_marca.nombre) : '—', 'marca preferida')}
    ${kpi(s.mejor_mate ? esc(s.mejor_mate.nombre) : '—', 'mate preferido')}
    ${kpi(s.modo ? esc(s.modo) : '—', 'cómo la toma')}
  </div>`;
}

$('#perfil-body').addEventListener('click', async e => {
  const tab = e.target.closest('[data-ptab]');
  if (tab) { social.perfilTab = tab.dataset.ptab; renderPerfil(); return; }
  const tile = e.target.closest('.ptile');
  if (tile) { abrirPost(+tile.dataset.id); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'seguir') manejarBotonSeguir(b);
  if (b.dataset.act === 'editar-perfil') abrirEditarPerfil();
  if (b.dataset.act === 'nueva') abrirForm();
  if (b.dataset.act === 'lista') abrirLista(social.perfil.usuario, b.dataset.tipo);
});

async function abrirLista(usuario, tipo) {
  const dlg = $('#dlg-lista');
  $('#lista-title').textContent = tipo === 'seguidos' ? 'Seguidos' : 'Seguidores';
  const body = $('#lista-body');
  body.innerHTML = '<p class="loading">Cargando…</p>';
  dlg.showModal();
  try {
    const lista = await api(`/api/social?accion=lista&usuario=${encodeURIComponent(usuario)}&tipo=${tipo}`);
    const propioSeguidores = esMio(usuario) && tipo === 'seguidores';
    body.innerHTML = lista.length
      ? lista.map(u => filaUsuario(u, propioSeguidores
          ? `${botonSeguir(u)}<button type="button" class="btn ghost sm" data-act="quitar" data-usuario="${esc(u.usuario)}">Quitar</button>`
          : '')).join('')
      : `<p class="muted" style="padding:12px 0">${tipo === 'seguidos' ? 'Todavía no sigue a nadie.' : 'Todavía no tiene seguidores.'}</p>`;
  } catch (error) {
    body.innerHTML = `<p class="muted">${esc(error.mensaje || error.message)}</p>`;
  }
}

$('#lista-body').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (b.dataset.act === 'seguir') return manejarBotonSeguir(b);
  if (b.dataset.act === 'quitar') {
    if (!(await confirmar(`¿Quitar a @${b.dataset.usuario}?`, 'Va a dejar de seguirte. No se le avisa.', 'Quitar'))) return;
    try {
      await api('/api/social?accion=quitar', { method: 'POST', body: { usuario: b.dataset.usuario } });
      b.closest('.user-row').remove();
      if (social.perfil) cargarPerfil(social.perfil.usuario);
    } catch (error) { toast(error.mensaje || error.message, { error: true }); }
  }
});
$('#lista-body').addEventListener('click', e => { if (e.target.closest('a')) $('#dlg-lista').close(); });

/* ---------- Editar perfil ---------- */
function abrirEditarPerfil() {
  const c = state.cuenta;
  const f = $('#form-perfil');
  f.nombre.value = c.nombre || '';
  f.bio.value = c.bio || '';
  f.privado.checked = !!c.privado;
  f['cfg-estadisticas'].checked = c.config.estadisticas !== false;
  f['cfg-quiero'].checked = c.config.quiero !== false;
  f['cfg-seguidores'].checked = c.config.seguidores !== false;
  social.avatarNuevo = undefined;
  pintarAvatarEdicion(c.avatar);
  $('#perfil-msg').hidden = true;
  $('#dlg-perfil').showModal();
}

function pintarAvatarEdicion(url) {
  $('#perfil-avatar-prev').innerHTML = avatarHTML({ ...state.cuenta, avatar: url }, 'xl');
  $('#perfil-avatar-quitar').hidden = !url;
}

$('#perfil-avatar-btn').addEventListener('click', () => $('#perfil-avatar-file').click());
$('#perfil-avatar-quitar').addEventListener('click', () => { social.avatarNuevo = null; pintarAvatarEdicion(null); });
$('#perfil-avatar-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const btn = $('#perfil-avatar-btn');
  btn.disabled = true;
  btn.textContent = 'Subiendo…';
  try {
    const url = await subirFoto(await procesarImagen(file, 480));
    social.avatarNuevo = url;
    pintarAvatarEdicion(url);
  } catch (error) {
    const msg = $('#perfil-msg');
    msg.className = 'auth-msg error';
    msg.textContent = `No pude subir la foto: ${error.mensaje || error.message}`;
    msg.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cambiar foto';
  }
});

$('#form-perfil').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.currentTarget;
  const boton = $('button[type="submit"]', f);
  boton.disabled = true;
  try {
    await api('/api/social?accion=perfil', {
      method: 'POST',
      body: {
        nombre: f.nombre.value.trim(),
        bio: f.bio.value.trim(),
        avatar: social.avatarNuevo === undefined ? state.cuenta.avatar : social.avatarNuevo,
        privado: f.privado.checked,
        config: { estadisticas: f['cfg-estadisticas'].checked, quiero: f['cfg-quiero'].checked, seguidores: f['cfg-seguidores'].checked },
      },
    });
    $('#dlg-perfil').close();
    await cargarCuenta();
    if (social.perfil && esMio(social.perfil.usuario)) cargarPerfil(state.cuenta.usuario);
    toast('Perfil actualizado ✔');
  } catch (error) {
    const msg = $('#perfil-msg');
    msg.className = 'auth-msg error';
    msg.textContent = error.mensaje || error.message;
    msg.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

/* ---------- Buscar usuarios ---------- */
const buscarUsuarios = debounce(async q => {
  const res = $('#buscar-res');
  if (!q.trim()) { res.innerHTML = '<p class="muted buscar-hint">Escribí un nombre de usuario para encontrar a otros materos.</p>'; return; }
  try {
    const lista = await api(`/api/social?accion=buscar&q=${encodeURIComponent(q)}`);
    if ($('#buscar-q').value !== q) return; // llegó una búsqueda más nueva
    res.innerHTML = lista.length ? lista.map(u => filaUsuario(u)).join('') : '<p class="muted buscar-hint">No encontramos usuarios con ese nombre.</p>';
  } catch (error) {
    res.innerHTML = `<p class="muted">${esc(error.mensaje || error.message)}</p>`;
  }
}, 250);
$('#buscar-q').addEventListener('input', e => buscarUsuarios(e.target.value));
$('#buscar-res').addEventListener('click', e => {
  const b = e.target.closest('[data-act="seguir"]');
  if (b) manejarBotonSeguir(b);
});
$('#buscar-res').innerHTML = '<p class="muted buscar-hint">Escribí un nombre de usuario para encontrar a otros materos.</p>';

// app.js arranca antes de que termine de cargar este archivo: si la cuenta ya llegó, ponerse al día.
if (state.cuenta) window.alCargarCuenta();
